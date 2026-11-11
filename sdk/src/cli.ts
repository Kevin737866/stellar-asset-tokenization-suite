/**
 * Stellar RWA Suite CLI
 *
 * Installation & Execution:
 *   npm install
 *   npm run build
 *   node dist/cli.js --help
 *   # or via npm script / global bin:
 *   npm run cli -- <command> [options]
 *   npx rwa-sdk <command> [options]
 *
 * Configuration File (`--config <path>` or `SATS_CLI_CONFIG`):
 *   JSON document defining named network profiles and contract addresses:
 *   {
 *     "defaultProfile": "testnet",
 *     "profiles": {
 *       "testnet": {
 *         "network": "testnet",
 *         "horizonUrl": "https://horizon-testnet.stellar.org",
 *         "rpcUrl": "https://soroban-testnet.stellar.org",
 *         "contracts": {
 *           "rwaToken": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
 *           "custodyValidator": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4"
 *         }
 *       }
 *     }
 *   }
 *
 * Environment Variables:
 *   STELLAR_SECRET   Signing secret key used when `--secret-env` is specified
 *   SATS_CLI_CONFIG  Default path to CLI JSON config file
 *   SATS_NETWORK     Default network name (`testnet` by default when omitted)
 *
 * Safe Network Selection:
 *   - Commands default to `testnet` when `--network` / profile is omitted.
 *   - Use `--dry-run` on `create-pool` and `liquidate` to validate parameters
 *     and inspect planned outputs without submitting any on-chain transaction.
 *   - Write commands targeting `mainnet` require explicit confirmation via
 *     `--confirm-mainnet` (non-interactive) or typing `MAINNET` interactively.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  Asset,
  LiquidityPoolAsset,
  Operation,
  TransactionBuilder,
  Keypair,
  Horizon
} from 'stellar-sdk';
import { STELLAR_NETWORKS } from './constants';
import { CustodyClient } from './custody';
import { runTypeGenerator } from './typeGenerator';

// ─────────────────────────────────────────────────────────────────────────────
// CLI Errors & Exit Codes
// ─────────────────────────────────────────────────────────────────────────────

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code = 'CLI_ERROR',
    exitCode = 1,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CliValidationError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CLI_VALIDATION_ERROR', 2, details);
  }
}

export class CliAuthorizationError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CLI_MAINNET_CONFIRMATION_REQUIRED', 3, details);
  }
}

export class CliNetworkError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CLI_NETWORK_ERROR', 4, details);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration, Output & Verification Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CliProfileConfig {
  network?: string;
  horizonUrl?: string;
  rpcUrl?: string;
  contracts?: Record<string, string>;
}

export interface CliConfigFile {
  defaultProfile?: string;
  profiles?: Record<string, CliProfileConfig>;
  [key: string]: unknown;
}

export interface ResolvedCliNetwork {
  profile: string;
  network: string;
  horizonUrl: string;
  rpcUrl?: string;
  passphrase: string;
  contracts: Record<string, string>;
}

export interface EnvRequirement {
  name: string;
  description: string;
}

export interface CliTransactionResult {
  command: 'create-pool' | 'liquidate';
  network: string;
  status: 'submitted' | 'dry-run' | 'skipped';
  dryRun: boolean;
  transactionHash: string | null;
  ledger: number | string | null;
  explorerUrl: string | null;
  details: Record<string, unknown>;
}

export interface ContractVerificationEntry {
  name: string;
  address: string;
  kind: 'contract' | 'account' | 'unknown';
  valid: boolean;
  network: string;
  reason?: string;
  rpcReachable?: boolean;
}

export interface VerifyContractsReport {
  command: 'verify-contracts';
  network: string;
  horizonUrl: string;
  rpcUrl?: string;
  checkedOnline: boolean;
  allValid: boolean;
  total: number;
  validCount: number;
  invalidCount: number;
  contracts: ContractVerificationEntry[];
}

export interface CliExecutionDeps {
  env?: NodeJS.ProcessEnv;
  confirmRl?: readline.Interface;
  checkEndpoint?: (url: string) => Promise<boolean>;
}

const CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/;
const ACCOUNT_ID_REGEX = /^G[A-Z2-7]{55}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Asset utilities
// ─────────────────────────────────────────────────────────────────────────────

function parseAsset(assetStr: string): Asset {
  if (assetStr.toUpperCase() === 'XLM' || assetStr.toUpperCase() === 'NATIVE') {
    return Asset.native();
  }
  const parts = assetStr.split(':');
  if (parts.length !== 2) {
    throw new CliValidationError(
      `Invalid asset format: "${assetStr}". Expected "XLM" or "CODE:ISSUER"`
    );
  }
  return new Asset(parts[0], parts[1]);
}

function compareAssets(a: Asset, b: Asset): number {
  if (a.isNative() && b.isNative()) return 0;
  if (a.isNative()) return -1;
  if (b.isNative()) return 1;

  const codeCompare = a.getCode().localeCompare(b.getCode());
  if (codeCompare !== 0) return codeCompare;

  return a.getIssuer().localeCompare(b.getIssuer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Config, Environment & Safety Guards
// ─────────────────────────────────────────────────────────────────────────────

export function validateRequiredEnv(
  requirements: EnvRequirement[],
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const missing: EnvRequirement[] = [];

  for (const req of requirements) {
    const val = env[req.name];
    if (typeof val !== 'string' || val.trim().length === 0) {
      missing.push(req);
    } else {
      resolved[req.name] = val.trim();
    }
  }

  if (missing.length > 0) {
    const names = missing.map((m) => `${m.name} (${m.description})`).join(', ');
    throw new CliValidationError(
      `Missing required environment variable(s): ${names}`,
      { missing: missing.map((m) => m.name) }
    );
  }

  return resolved;
}

export function loadNetworkProfile(
  configPath: string,
  profileName?: string
): ResolvedCliNetwork {
  if (!configPath || configPath.trim().length === 0) {
    throw new CliValidationError('Config file path cannot be empty');
  }
  if (!fs.existsSync(configPath)) {
    throw new CliValidationError(`CLI config file not found: ${configPath}`);
  }

  let raw: CliConfigFile;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as CliConfigFile;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliValidationError(`Invalid JSON in CLI config file "${configPath}": ${msg}`);
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CliValidationError(`CLI config file "${configPath}" must export a JSON object`);
  }

  const profileMap: Record<string, CliProfileConfig> =
    raw.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles)
      ? raw.profiles
      : Object.fromEntries(
          Object.entries(raw).filter(
            ([k, v]) => k !== 'defaultProfile' && v != null && typeof v === 'object' && !Array.isArray(v)
          ) as Array<[string, CliProfileConfig]>
        );

  const selectedName =
    profileName ||
    (typeof raw.defaultProfile === 'string' && raw.defaultProfile.trim().length > 0
      ? raw.defaultProfile.trim()
      : 'testnet');

  const profile = profileMap[selectedName];
  if (!profile || typeof profile !== 'object') {
    const available = Object.keys(profileMap);
    throw new CliValidationError(
      `Network profile "${selectedName}" not found in "${configPath}". Available profiles: ${
        available.length > 0 ? available.join(', ') : '(none)'
      }`
    );
  }

  const networkName = profile.network || selectedName;
  const baseNetwork = STELLAR_NETWORKS[networkName];
  if (!baseNetwork) {
    throw new CliValidationError(
      `Unsupported network "${networkName}" in profile "${selectedName}". Supported: ${Object.keys(STELLAR_NETWORKS).join(', ')}`
    );
  }

  const horizonUrl = profile.horizonUrl || baseNetwork.horizonUrl;
  try {
    new URL(horizonUrl);
  } catch {
    throw new CliValidationError(
      `Invalid horizonUrl "${horizonUrl}" in profile "${selectedName}"`
    );
  }

  if (profile.rpcUrl) {
    try {
      new URL(profile.rpcUrl);
    } catch {
      throw new CliValidationError(
        `Invalid rpcUrl "${profile.rpcUrl}" in profile "${selectedName}"`
      );
    }
  }

  const contracts: Record<string, string> = {};
  if (profile.contracts && typeof profile.contracts === 'object') {
    for (const [k, v] of Object.entries(profile.contracts)) {
      if (typeof v === 'string' && v.trim().length > 0) {
        contracts[k] = v.trim();
      }
    }
  }

  return {
    profile: selectedName,
    network: networkName,
    horizonUrl,
    rpcUrl: profile.rpcUrl,
    passphrase: baseNetwork.passphrase,
    contracts,
  };
}

export function resolveNetworkSettings(
  options: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): ResolvedCliNetwork {
  const configPath =
    (options['config'] && options['config'] !== 'true' ? options['config'] : undefined) ??
    (env.SATS_CLI_CONFIG && env.SATS_CLI_CONFIG.trim().length > 0 ? env.SATS_CLI_CONFIG.trim() : undefined);

  const explicitProfile =
    options['profile'] && options['profile'] !== 'true' ? options['profile'] : undefined;

  let resolved: ResolvedCliNetwork;
  if (configPath) {
    resolved = loadNetworkProfile(configPath, explicitProfile || options['network']);
    if (options['network'] && options['network'] !== 'true' && !explicitProfile) {
      // Allow `--network` override if profile was resolved via `--profile` or default
      const explicitNet = STELLAR_NETWORKS[options['network']];
      if (!explicitNet) {
        throw new CliValidationError(
          `Unsupported network: "${options['network']}". Supported: ${Object.keys(STELLAR_NETWORKS).join(', ')}`
        );
      }
    }
  } else {
    const networkName =
      (options['network'] && options['network'] !== 'true' ? options['network'] : undefined) ||
      (env.SATS_NETWORK && env.SATS_NETWORK.trim().length > 0 ? env.SATS_NETWORK.trim() : 'testnet');
    const net = STELLAR_NETWORKS[networkName];
    if (!net) {
      throw new CliValidationError(
        `Unsupported network: "${networkName}". Supported: ${Object.keys(STELLAR_NETWORKS).join(', ')}`
      );
    }
    resolved = {
      profile: networkName,
      network: networkName,
      horizonUrl: net.horizonUrl,
      passphrase: net.passphrase,
      contracts: {},
    };
  }

  if (options['horizon-url'] && options['horizon-url'] !== 'true') {
    try {
      new URL(options['horizon-url']);
    } catch {
      throw new CliValidationError(`Invalid --horizon-url: "${options['horizon-url']}"`);
    }
    resolved = { ...resolved, horizonUrl: options['horizon-url'] };
  }

  if (options['rpc-url'] && options['rpc-url'] !== 'true') {
    try {
      new URL(options['rpc-url']);
    } catch {
      throw new CliValidationError(`Invalid --rpc-url: "${options['rpc-url']}"`);
    }
    resolved = { ...resolved, rpcUrl: options['rpc-url'] };
  }

  return resolved;
}

export function resolveSecretValue(
  options: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (options['secret-env']) {
    const envVarName = options['secret-env'] === 'true' ? 'STELLAR_SECRET' : options['secret-env'];
    const vars = validateRequiredEnv(
      [{ name: envVarName, description: 'Stellar signing secret key' }],
      env
    );
    return vars[envVarName];
  }

  const secret = options['secret'];
  if (!secret || secret === 'true') {
    return undefined;
  }

  if (secret.startsWith('env:')) {
    const envVarName = secret.slice(4).trim();
    if (!envVarName) {
      throw new CliValidationError('Invalid env: reference in --secret');
    }
    const vars = validateRequiredEnv(
      [{ name: envVarName, description: 'Stellar signing secret key' }],
      env
    );
    return vars[envVarName];
  }

  return secret;
}

export async function confirmMainnetWrite(
  command: string,
  options: Record<string, string>,
  deps: CliExecutionDeps = {}
): Promise<void> {
  if (options['confirm-mainnet'] === 'true') {
    return;
  }

  const rl = deps.confirmRl;
  if (!rl && !process.stdin.isTTY) {
    throw new CliAuthorizationError(
      `Mainnet write guard blocked "${command}". Re-run interactively or pass --confirm-mainnet to authorize live mainnet submission.`,
      { command, network: 'mainnet' }
    );
  }

  const ownedRl =
    rl ??
    readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

  try {
    console.warn(
      `\n⚠️  MAINNET WRITE GUARD: You are about to execute "${command}" on Stellar MAINNET.`
    );
    const answer = await prompt(
      ownedRl,
      'Type "MAINNET" to confirm live transaction submission (or anything else to abort)',
      { defaultValue: 'abort' }
    );
    if (answer !== 'MAINNET') {
      throw new CliAuthorizationError(
        `Mainnet confirmation failed for "${command}" (expected "MAINNET", received "${answer}"). Operation aborted.`,
        { command, network: 'mainnet' }
      );
    }
  } finally {
    if (!rl) {
      ownedRl.close();
    }
  }
}

export function buildExplorerUrl(network: string, hash: string | null): string | null {
  if (!hash) return null;
  if (network === 'mainnet') {
    return `https://stellar.expert/explorer/public/tx/${hash}`;
  }
  if (network === 'testnet') {
    return `https://stellar.expert/explorer/testnet/tx/${hash}`;
  }
  return null;
}

export function formatCliOutput(payload: unknown, jsonMode: boolean): string {
  return jsonMode ? JSON.stringify(payload, null, 2) : String(payload);
}

export function formatTransactionResult(
  result: CliTransactionResult,
  jsonMode: boolean
): string {
  if (jsonMode) {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [
    result.dryRun
      ? `[DRY-RUN] ${result.command} validated (no transaction submitted)`
      : `Command ${result.command} (${result.status})`,
    `  Network:          ${result.network}`,
    `  Status:           ${result.status}`,
    `  Transaction Hash: ${result.transactionHash ?? 'none (dry-run)'}`,
    `  Ledger:           ${result.ledger ?? 'pending'}`,
  ];
  if (result.explorerUrl) {
    lines.push(`  Explorer URL:     ${result.explorerUrl}`);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Help text & documentation
// ─────────────────────────────────────────────────────────────────────────────

export const CLI_HELP_METADATA = {
  name: 'stellar-rwa-cli',
  commands: [
    'create-pool',
    'liquidate',
    'generate-types',
    'verify-contracts',
  ] as const,
  defaultNetwork: 'testnet',
  envVars: [
    { name: 'STELLAR_SECRET', description: 'Signing secret key used with --secret-env' },
    { name: 'SATS_CLI_CONFIG', description: 'Default JSON config file path for --config' },
    { name: 'SATS_NETWORK', description: 'Default Stellar network (testnet, mainnet, futurenet, standalone)' },
  ],
};

export function getCliHelpText(command?: string): string {
  if (command === 'create-pool') {
    return `
Stellar RWA Suite CLI - Pool Creation Command

Usage:
  node dist/cli.js create-pool [options]

Options:
  --asset-a <asset>      First asset (e.g. "XLM" or "CODE:ISSUER") [required]
  --asset-b <asset>      Second asset (e.g. "CODE:ISSUER") [required]
  --amount-a <amount>    Maximum amount of Asset A to deposit [required]
  --amount-b <amount>    Maximum amount of Asset B to deposit [required]
  --fee <fee>            Liquidity pool fee in basis points (default: 30)
  --secret <secret>      Secret key of the depositor (or use --secret-env) [required]
  --secret-env [VAR]     Read signing secret from env var (default: STELLAR_SECRET)
  --network <network>    Stellar network: testnet, mainnet, futurenet, standalone (default: testnet)
  --config <file.json>   Load network profile and contract defaults from JSON config
  --profile <name>       Profile name inside --config (default: config.defaultProfile or testnet)
  --horizon-url <url>    Horizon server URL (optional, overrides default for network)
  --slippage <slippage>  Slippage tolerance as a decimal (default: 0.01 for 1%)
  --dry-run              Validate parameters and compute pool bounds without submitting
  --confirm-mainnet      Acknowledge live mainnet submission without interactive prompt
  --json                 Output structured JSON result
  --help, -h             Show this help message

Examples:
  node dist/cli.js create-pool --asset-a XLM --asset-b USDC:GA5Z... --amount-a 100 --amount-b 10 --secret S... --dry-run
  STELLAR_SECRET=S... node dist/cli.js create-pool --asset-a XLM --asset-b USDC:GA5Z... --amount-a 50 --amount-b 5 --secret-env --json
  node dist/cli.js create-pool --config sats.config.json --profile mainnet --confirm-mainnet --asset-a XLM --asset-b USDC:GA5Z... --amount-a 100 --amount-b 10 --secret-env
`;
  }

  if (command === 'liquidate') {
    return `
Stellar RWA Suite CLI - Liquidate Command

Liquidates an undercollateralized RWA position by triggering an insurance claim
on the Custody Validator contract. Checks collateralization unless --force is set.

Usage:
  node dist/cli.js liquidate [options]

Options:
  --asset-id <address>          On-chain contract address of the RWA token [required unless in --config]
  --custody-validator <address> Custody Validator contract address [required unless in --config]
  --secret <secret>             Secret key of authorized admin (or use --secret-env) [required]
  --secret-env [VAR]            Read signing secret from env var (default: STELLAR_SECRET)
  --reason <reason>             Short reason code for the claim (default: "undercollateralized")
  --evidence-hash <hash>        64-character hex evidence hash (32 bytes) [required]
  --network <network>           Stellar network: testnet, mainnet, futurenet, standalone (default: testnet)
  --config <file.json>          Load network profile and contract defaults from JSON config
  --profile <name>              Profile name inside --config
  --horizon-url <url>           Horizon server URL (optional, overrides default for network)
  --force                       Skip collateralization check and liquidate unconditionally
  --dry-run                     Validate inputs and mainnet guards without calling contract
  --confirm-mainnet             Acknowledge live mainnet submission without interactive prompt
  --json                        Output structured JSON result
  --help, -h                    Show this help message

Examples:
  node dist/cli.js liquidate --asset-id C... --custody-validator C... --evidence-hash <64-hex> --secret S... --dry-run
  STELLAR_SECRET=S... node dist/cli.js liquidate --config sats.config.json --evidence-hash <64-hex> --secret-env --json
`;
  }

  if (command === 'generate-types') {
    return `
Stellar RWA Suite CLI - Type Generator

Generates a TypeScript module from Soroban contract SCHEMA (spec) entries.

Usage:
  npx rwa-sdk generate-types --contracts <id[,id...]> --rpc-url <url> [options]
  npx rwa-sdk generate-types --schema <file.json> [--schema <file.json>...] [options]

Options:
  --contracts <ids>       Comma-separated contract ids to fetch from the network
  --rpc-url <url>         Soroban RPC URL (required with --contracts)
  --network <network>     Network passphrase preset: testnet, mainnet, futurenet, standalone (default: testnet)
  --schema <file.json>    Local schema JSON file (repeatable)
  --out <file.ts>         Write the generated module here (default: stdout)
  --manual-types <file>   Manual types module to diff generated names against
  --no-client             Do not emit the <Name>Client interface
  --dry-run               Print the result and warnings without writing --out
  --json                  Emit structured JSON summary for generated types
  --help, -h              Show this help message

Examples:
  node dist/cli.js generate-types --schema ./spec.json --out ./sdk/src/generated.ts
  node dist/cli.js generate-types --contracts C... --rpc-url https://soroban-testnet.stellar.org --dry-run --json
`;
  }

  if (command === 'verify-contracts') {
    return `
Stellar RWA Suite CLI - Verify Contracts Command

Validates configured Soroban contract IDs (and optional account IDs) from CLI
flags or a --config network profile before deploying or running write operations.

Usage:
  node dist/cli.js verify-contracts [options]

Options:
  --config <file.json>          Load contract addresses from a JSON profile
  --profile <name>              Profile name inside --config
  --network <network>           Stellar network preset (default: testnet)
  --asset-id <address>          Verify an RWA token contract address
  --custody-validator <address> Verify a Custody Validator contract address
  --contracts <id1,id2,...>     Comma-separated list of contract IDs to verify
  --contract <name=address>     Named contract entry (repeatable)
  --allow-account               Also accept G... Stellar account public keys
  --check-rpc                   Check Horizon/RPC endpoint reachability (offline syntax-only by default)
  --json                        Emit machine-readable JSON verification report
  --help, -h                    Show this help message

Examples:
  node dist/cli.js verify-contracts --config sats.config.json --profile testnet --json
  node dist/cli.js verify-contracts --contracts CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM --json
  node dist/cli.js verify-contracts --contract rwaToken=C... --contract custody=C... --check-rpc
`;
  }

  return `
Stellar RWA Suite CLI

Install & Setup:
  npm install && npm run build
  node dist/cli.js <command> [options]

Usage:
  node dist/cli.js <command> [options]
  node dist/cli.js --interactive
  node dist/cli.js -i

Commands:
  create-pool       Create and fund a Stellar liquidity pool
  liquidate         Liquidate an undercollateralized RWA position
  generate-types    Generate TypeScript types from Soroban contract schemas
  verify-contracts  Verify configured Soroban contract addresses and endpoints

Global Options:
  --interactive, -i   Launch guided interactive prompt mode
  --config <path>     Load named network profile & contracts JSON (or env SATS_CLI_CONFIG)
  --profile <name>    Select profile inside --config (default: testnet)
  --json              Output machine-readable JSON (for supported commands / --help)
  --help, -h          Show this help message

Safe Network Defaults:
  - Defaults to "testnet" unless --network or --profile overrides it.
  - Use --dry-run on create-pool and liquidate before live submission.
  - Mainnet writes require explicit confirmation (--confirm-mainnet or typing MAINNET).

Examples:
  node dist/cli.js verify-contracts --config sats.config.json --json
  node dist/cli.js create-pool --asset-a XLM --asset-b USDC:GA5Z... --amount-a 100 --amount-b 10 --secret S... --dry-run
  node dist/cli.js liquidate --asset-id C... --custody-validator C... --evidence-hash <64-hex> --secret-env --dry-run
  node dist/cli.js generate-types --schema ./spec.json --dry-run
  node dist/cli.js --interactive
`;
}

function printHelp(jsonMode = false) {
  if (jsonMode) {
    console.log(formatCliOutput({ ...CLI_HELP_METADATA, help: getCliHelpText() }, true));
    return;
  }
  console.log(getCliHelpText());
}

function printGenerateTypesHelp(jsonMode = false) {
  const text = getCliHelpText('generate-types');
  if (jsonMode) {
    console.log(formatCliOutput({ command: 'generate-types', help: text }, true));
    return;
  }
  console.log(text);
}

function printCreatePoolHelp(jsonMode = false) {
  const text = getCliHelpText('create-pool');
  if (jsonMode) {
    console.log(formatCliOutput({ command: 'create-pool', help: text }, true));
    return;
  }
  console.log(text);
}

function printLiquidateHelp(jsonMode = false) {
  const text = getCliHelpText('liquidate');
  if (jsonMode) {
    console.log(formatCliOutput({ command: 'liquidate', help: text }, true));
    return;
  }
  console.log(text);
}

function printVerifyContractsHelp(jsonMode = false) {
  const text = getCliHelpText('verify-contracts');
  if (jsonMode) {
    console.log(formatCliOutput({ command: 'verify-contracts', help: text }, true));
    return;
  }
  console.log(text);
}

function collectRepeated(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1] && !args[i + 1].startsWith('--')) {
      out.push(args[i + 1]);
      i++;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

export function parseArgs(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 2) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        options[key] = val;
        continue;
      }
      const key = arg.slice(2);
      const val = args[i + 1];
      if (val && !val.startsWith('--')) {
        options[key] = val;
        i++;
      } else {
        options[key] = 'true';
      }
    }
  }
  return options;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive prompt helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptOptions {
  description?: string;
  defaultValue?: string;
  validate?: (input: string) => string | null; // returns error message or null
}

/**
 * Prompts the user for a single value, re-prompting on validation failure.
 * Exported so tests can spy on / mock it.
 */
export async function prompt(
  rl: readline.Interface,
  question: string,
  opts: PromptOptions = {}
): Promise<string> {
  const { description, defaultValue, validate } = opts;

  if (description) {
    console.log(`\n  ℹ  ${description}`);
  }

  const displayQuestion = defaultValue
    ? `  ${question} [${defaultValue}]: `
    : `  ${question}: `;

  return new Promise((resolve) => {
    const ask = () => {
      rl.question(displayQuestion, (answer) => {
        const value = answer.trim() === '' ? (defaultValue ?? '') : answer.trim();

        if (value === '') {
          console.log('  ⚠  This field is required.');
          ask();
          return;
        }

        if (validate) {
          const error = validate(value);
          if (error) {
            console.log(`  ⚠  ${error}`);
            ask();
            return;
          }
        }

        resolve(value);
      });
    };
    ask();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared validators (exported for reuse in tests)
// ─────────────────────────────────────────────────────────────────────────────

export const validators = {
  network: (value: string): string | null => {
    const valid = ['testnet', 'mainnet', 'futurenet', 'standalone'];
    return valid.includes(value)
      ? null
      : `Must be one of: ${valid.join(', ')}`;
  },

  secret: (value: string): string | null => {
    try {
      Keypair.fromSecret(value);
      return null;
    } catch {
      return 'Invalid Stellar secret key (must start with "S" and be 56 characters)';
    }
  },

  asset: (value: string): string | null => {
    try {
      parseAsset(value);
      return null;
    } catch {
      return 'Invalid asset format. Use "XLM" for native, or "CODE:ISSUER" for non-native assets';
    }
  },

  positiveNumber: (value: string): string | null => {
    const n = parseFloat(value);
    return isNaN(n) || n <= 0 ? 'Must be a positive number' : null;
  },

  feeBasicPoints: (value: string): string | null => {
    const n = parseInt(value, 10);
    if (isNaN(n) || n <= 0 || n > 10000) {
      return 'Fee must be an integer between 1 and 10000 basis points';
    }
    return null;
  },

  slippage: (value: string): string | null => {
    const n = parseFloat(value);
    if (isNaN(n) || n < 0 || n >= 1) {
      return 'Slippage must be a decimal between 0 and 1 (e.g. 0.01 for 1%)';
    }
    return null;
  },

  contractAddress: (value: string): string | null => {
    if (!/^[A-Z0-9]{56}$/.test(value)) {
      return 'Must be a valid 56-character Stellar address (contract or account)';
    }
    return null;
  },

  evidenceHash: (value: string): string | null => {
    return /^[0-9a-fA-F]{64}$/.test(value)
      ? null
      : 'Must be a 64-character hexadecimal string (32 bytes)';
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-command interactive prompt flows
// ─────────────────────────────────────────────────────────────────────────────

export async function promptCreatePool(
  rl: readline.Interface
): Promise<Record<string, string>> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Create Liquidity Pool — Guided Setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const network = await prompt(rl, 'Network', {
    description: 'Stellar network to connect to (testnet, mainnet, futurenet, standalone)',
    defaultValue: 'testnet',
    validate: validators.network,
  });

  const secret = await prompt(rl, 'Depositor secret key', {
    description: 'Secret key (starts with "S") of the account that will fund the pool',
    validate: validators.secret,
  });

  const assetA = await prompt(rl, 'Asset A', {
    description: 'First asset — use "XLM" for native Lumens, or "CODE:ISSUER" for other assets',
    validate: validators.asset,
  });

  const assetB = await prompt(rl, 'Asset B', {
    description: 'Second asset — use "CODE:ISSUER" format (e.g. USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN)',
    validate: validators.asset,
  });

  const amountA = await prompt(rl, 'Max amount of Asset A to deposit', {
    description: 'Maximum amount of Asset A you want to contribute to the pool',
    validate: validators.positiveNumber,
  });

  const amountB = await prompt(rl, 'Max amount of Asset B to deposit', {
    description: 'Maximum amount of Asset B you want to contribute to the pool',
    validate: validators.positiveNumber,
  });

  const fee = await prompt(rl, 'Pool fee (basis points)', {
    description: 'Fee charged per trade in basis points. 30 = 0.30%, the Stellar DEX standard',
    defaultValue: '30',
    validate: validators.feeBasicPoints,
  });

  const slippage = await prompt(rl, 'Slippage tolerance', {
    description: 'Maximum price ratio drift allowed (0.01 = 1%). Larger values reduce failed transactions in volatile markets',
    defaultValue: '0.01',
    validate: validators.slippage,
  });

  return {
    'asset-a': assetA,
    'asset-b': assetB,
    'amount-a': amountA,
    'amount-b': amountB,
    fee,
    secret,
    network,
    slippage,
  };
}

export async function promptLiquidate(
  rl: readline.Interface
): Promise<Record<string, string>> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Liquidate RWA Position — Guided Setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const network = await prompt(rl, 'Network', {
    description: 'Stellar network to connect to (testnet, mainnet, futurenet, standalone)',
    defaultValue: 'testnet',
    validate: validators.network,
  });

  const secret = await prompt(rl, 'Admin secret key', {
    description: 'Secret key of the authorized admin account that will trigger the liquidation',
    validate: validators.secret,
  });

  const assetId = await prompt(rl, 'RWA token contract address', {
    description: 'On-chain contract address of the RWA token to be liquidated',
    validate: validators.contractAddress,
  });

  const custodyValidator = await prompt(rl, 'Custody Validator contract address', {
    description: 'Address of the Custody Validator smart contract that holds collateral attestations',
    validate: validators.contractAddress,
  });

  const evidenceHash = await prompt(rl, 'Evidence hash', {
    description: 'A 64-character hex string (32 bytes) that references off-chain liquidation evidence',
    validate: validators.evidenceHash,
  });

  const reason = await prompt(rl, 'Reason code', {
    description: 'Short reason code logged on-chain explaining why the liquidation is triggered',
    defaultValue: 'undercollateralized',
  });

  const forceAnswer = await prompt(rl, 'Skip collateralization check? (yes/no)', {
    description: 'If "yes", the collateral verification step is bypassed and liquidation proceeds immediately',
    defaultValue: 'no',
  });

  const options: Record<string, string> = {
    'asset-id': assetId,
    'custody-validator': custodyValidator,
    secret,
    reason,
    'evidence-hash': evidenceHash,
    network,
  };

  if (forceAnswer.toLowerCase() === 'yes' || forceAnswer.toLowerCase() === 'y') {
    options['force'] = 'true';
  }

  return options;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command selection prompt
// ─────────────────────────────────────────────────────────────────────────────

export async function promptCommandSelection(
  rl: readline.Interface
): Promise<string> {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║    Stellar RWA Suite — Interactive CLI   ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('Available commands:\n');
  console.log('  1. create-pool  — Create and fund a Stellar liquidity pool');
  console.log('  2. liquidate    — Liquidate an undercollateralized RWA position\n');

  const raw = await prompt(rl, 'Select a command (create-pool / liquidate)', {
    description: 'You can type the command name or its number (1 or 2)',
    validate: (value) => {
      const normalized = value === '1' ? 'create-pool' : value === '2' ? 'liquidate' : value;
      return ['create-pool', 'liquidate'].includes(normalized)
        ? null
        : 'Please enter "create-pool" (or 1) or "liquidate" (or 2)';
    },
  });

  return raw === '1' ? 'create-pool' : raw === '2' ? 'liquidate' : raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive mode entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runInteractive(
  rlOverride?: readline.Interface
): Promise<void> {
  const rl =
    rlOverride ??
    readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

  const closeIfOwned = () => {
    if (!rlOverride) rl.close();
  };

  try {
    const command = await promptCommandSelection(rl);

    let options: Record<string, string>;
    if (command === 'create-pool') {
      options = await promptCreatePool(rl);
    } else {
      options = await promptLiquidate(rl);
    }

    // Show review summary, masking secret key
    console.log('\n──────────────────────────────────────────');
    console.log('  Review your inputs:');
    for (const [key, value] of Object.entries(options)) {
      const display = key === 'secret' ? '*'.repeat(8) : value;
      console.log(`    ${key}: ${display}`);
    }
    console.log('──────────────────────────────────────────\n');

    const confirm = await prompt(rl, 'Proceed with these settings? (yes/no)', {
      defaultValue: 'yes',
    });

    if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
      console.log('\nOperation cancelled.');
      closeIfOwned();
      return;
    }

    // Convert options map back to flat arg array for the existing runners
    const argArray = Object.entries(options).flatMap(([k, v]) =>
      v === 'true' ? [`--${k}`] : [`--${k}`, v]
    );

    closeIfOwned();

    if (command === 'create-pool') {
      await runCreatePool(argArray);
    } else {
      await runLiquidate(argArray);
    }
  } catch (err) {
    closeIfOwned();
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// generate-types command
// ─────────────────────────────────────────────────────────────────────────────

export async function runGenerateTypes(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const jsonMode = options['json'] === 'true';
  if (args.includes('--help') || args.includes('-h')) {
    printGenerateTypesHelp(jsonMode);
    return;
  }

  const contracts = (options['contracts'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const schemaFiles = collectRepeated(args, '--schema');
  if (options['schema'] && !schemaFiles.includes(options['schema']) && options['schema'] !== 'true') {
    schemaFiles.push(options['schema']);
  }

  if (contracts.length === 0 && schemaFiles.length === 0) {
    throw new CliValidationError('Provide --contracts <ids> or at least one --schema <file.json>');
  }

  const networkSettings = resolveNetworkSettings(options);
  let manualTypesFile = options['manual-types'];
  if (!manualTypesFile) {
    const candidate = path.join(__dirname, 'types.ts');
    if (fs.existsSync(candidate)) manualTypesFile = candidate;
  }

  const result = await runTypeGenerator({
    schemaFiles,
    contracts,
    rpcUrl: options['rpc-url'] || networkSettings.rpcUrl,
    networkPassphrase: networkSettings.passphrase,
    outFile: options['out'],
    emitClient: options['no-client'] !== 'true',
    manualTypesFile,
    dryRun: options['dry-run'] === 'true',
  });

  if (jsonMode) {
    console.log(
      formatCliOutput(
        {
          command: 'generate-types',
          network: networkSettings.network,
          schemasLoaded: result.schemasLoaded,
          declaredTypes: result.declaredTypes,
          warnings: result.warnings,
          written: result.written,
          outFile: result.outFile ?? null,
          dryRun: options['dry-run'] === 'true',
        },
        true
      )
    );
    return;
  }

  console.log(`Loaded ${result.schemasLoaded} schema(s); declared ${result.declaredTypes.length} type(s).`);
  for (const warning of result.warnings) {
    console.warn(`⚠️  ${warning}`);
  }

  if (result.written) {
    console.log(`✅ Wrote ${result.outFile}`);
  } else if (options['out'] && options['dry-run'] === 'true') {
    console.log(`(dry run) would write ${options['out']}`);
    console.log(result.code);
  } else {
    console.log(result.code);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// verify-contracts command
// ─────────────────────────────────────────────────────────────────────────────

export function verifyContractEntries(
  entries: Array<{ name: string; address: string }>,
  network: string,
  allowAccount = false
): ContractVerificationEntry[] {
  return entries.map(({ name, address }) => {
    const trimmed = address.trim();
    if (CONTRACT_ID_REGEX.test(trimmed)) {
      return {
        name,
        address: trimmed,
        kind: 'contract',
        valid: true,
        network,
      };
    }
    if (ACCOUNT_ID_REGEX.test(trimmed)) {
      return {
        name,
        address: trimmed,
        kind: 'account',
        valid: allowAccount,
        network,
        ...(allowAccount
          ? {}
          : { reason: 'Address is a Stellar G... account public key; expected a C... Soroban contract ID (pass --allow-account to allow accounts)' }),
      };
    }
    return {
      name,
      address: trimmed,
      kind: 'unknown',
      valid: false,
      network,
      reason: 'Invalid Stellar contract ID format (expected 56-character StrKey starting with "C" using Base32 A-Z, 2-7)',
    };
  });
}

export async function runVerifyContracts(
  args: string[],
  deps: CliExecutionDeps = {}
): Promise<VerifyContractsReport> {
  const options = parseArgs(args);
  const jsonMode = options['json'] === 'true';

  if (args.includes('--help') || args.includes('-h')) {
    printVerifyContractsHelp(jsonMode);
    return {
      command: 'verify-contracts',
      network: 'testnet',
      horizonUrl: STELLAR_NETWORKS.testnet.horizonUrl,
      checkedOnline: false,
      allValid: true,
      total: 0,
      validCount: 0,
      invalidCount: 0,
      contracts: [],
    };
  }

  const env = deps.env ?? process.env;
  const networkSettings = resolveNetworkSettings(options, env);
  const allowAccount = options['allow-account'] === 'true';
  const checkRpc = options['check-rpc'] === 'true';

  const candidates: Array<{ name: string; address: string }> = [];
  for (const [name, address] of Object.entries(networkSettings.contracts)) {
    candidates.push({ name, address });
  }
  if (options['asset-id'] && options['asset-id'] !== 'true') {
    candidates.push({ name: 'asset-id', address: options['asset-id'] });
  }
  if (options['custody-validator'] && options['custody-validator'] !== 'true') {
    candidates.push({ name: 'custody-validator', address: options['custody-validator'] });
  }
  if (options['contracts'] && options['contracts'] !== 'true') {
    const split = options['contracts']
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    split.forEach((address, idx) => {
      candidates.push({ name: `contract-${idx + 1}`, address });
    });
  }
  for (const raw of collectRepeated(args, '--contract')) {
    const eq = raw.indexOf('=');
    if (eq > 0) {
      candidates.push({ name: raw.slice(0, eq).trim(), address: raw.slice(eq + 1).trim() });
    } else {
      candidates.push({ name: `contract-${candidates.length + 1}`, address: raw.trim() });
    }
  }

  if (candidates.length === 0) {
    throw new CliValidationError(
      'No contract addresses provided. Supply --config, --asset-id, --custody-validator, --contract, or --contracts.'
    );
  }

  const verified = verifyContractEntries(candidates, networkSettings.network, allowAccount);

  if (checkRpc) {
    const targetUrl = networkSettings.rpcUrl || networkSettings.horizonUrl;
    const probe =
      deps.checkEndpoint ??
      (async (url: string): Promise<boolean> => {
        if (typeof fetch !== 'function') return false;
        const res = await fetch(url);
        return res.ok;
      });
    let reachable = false;
    try {
      reachable = await probe(targetUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CliNetworkError(
        `Failed to reach Stellar endpoint "${targetUrl}": ${msg}`,
        { url: targetUrl }
      );
    }
    if (!reachable) {
      throw new CliNetworkError(`Stellar endpoint "${targetUrl}" returned unhealthy response`, {
        url: targetUrl,
      });
    }
    for (const entry of verified) {
      entry.rpcReachable = reachable;
    }
  }

  const validCount = verified.filter((c) => c.valid).length;
  const invalidCount = verified.length - validCount;
  const report: VerifyContractsReport = {
    command: 'verify-contracts',
    network: networkSettings.network,
    horizonUrl: networkSettings.horizonUrl,
    ...(networkSettings.rpcUrl ? { rpcUrl: networkSettings.rpcUrl } : {}),
    checkedOnline: checkRpc,
    allValid: invalidCount === 0,
    total: verified.length,
    validCount,
    invalidCount,
    contracts: verified,
  };

  if (jsonMode) {
    console.log(formatCliOutput(report, true));
  } else {
    console.log(`Contract Verification (${report.network} — ${report.horizonUrl}):`);
    for (const entry of verified) {
      const mark = entry.valid ? '✅' : '❌';
      const detail = entry.reason ? ` — ${entry.reason}` : ` (${entry.kind})`;
      console.log(`  ${mark} ${entry.name}: ${entry.address}${detail}`);
    }
  }

  if (!report.allValid) {
    throw new CliValidationError(
      `Contract verification failed: ${invalidCount} of ${verified.length} address(es) invalid`,
      { report }
    );
  }

  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// create-pool command
// ─────────────────────────────────────────────────────────────────────────────

export async function runCreatePool(
  args: string[],
  deps: CliExecutionDeps = {}
): Promise<CliTransactionResult | void> {
  const options = parseArgs(args);
  const jsonMode = options['json'] === 'true';
  const dryRun = options['dry-run'] === 'true';
  const env = deps.env ?? process.env;

  if (args.includes('--help') || args.includes('-h')) {
    printCreatePoolHelp(jsonMode);
    return;
  }

  const secret = resolveSecretValue(options, env);
  if (secret) {
    options['secret'] = secret;
  }

  const required = ['asset-a', 'asset-b', 'amount-a', 'amount-b', 'secret'];
  for (const req of required) {
    if (!options[req] || options[req] === 'true') {
      if (!jsonMode) {
        console.error(`Error: Missing required option --${req}`);
      }
      throw new CliValidationError(`Missing required option --${req}`);
    }
  }

  const networkSettings = resolveNetworkSettings(options, env);
  const networkName = networkSettings.network;
  const horizonUrl = networkSettings.horizonUrl;

  const assetAStr = options['asset-a'];
  const assetBStr = options['asset-b'];
  const amountA = options['amount-a'];
  const amountB = options['amount-b'];
  const feeStr = options['fee'] || '30';
  const slippageStr = options['slippage'] || '0.01';

  const amountAErr = validators.positiveNumber(amountA);
  if (amountAErr) throw new CliValidationError(`Invalid --amount-a: ${amountAErr}`);
  const amountBErr = validators.positiveNumber(amountB);
  if (amountBErr) throw new CliValidationError(`Invalid --amount-b: ${amountBErr}`);
  const feeErr = validators.feeBasicPoints(feeStr);
  if (feeErr) throw new CliValidationError(`Invalid --fee: ${feeErr}`);
  const slippageErr = validators.slippage(slippageStr);
  if (slippageErr) throw new CliValidationError(`Invalid --slippage: ${slippageErr}`);

  let depositorKeypair: Keypair;
  try {
    depositorKeypair = Keypair.fromSecret(options['secret']);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliValidationError(`Invalid --secret key: ${msg}`);
  }

  const fee = parseInt(feeStr, 10);
  const slippage = parseFloat(slippageStr);
  const depositorAddress = depositorKeypair.publicKey();

  const assetA = parseAsset(assetAStr);
  const assetB = parseAsset(assetBStr);

  // Sort assets lexicographically
  let sortedAssetA = assetA;
  let sortedAssetB = assetB;
  let sortedAmountA = amountA;
  let sortedAmountB = amountB;

  if (compareAssets(assetA, assetB) > 0) {
    if (!jsonMode) {
      console.log('Swapping assets lexicographically (Asset A must be lexicographically smaller than Asset B in Stellar LP)...');
    }
    sortedAssetA = assetB;
    sortedAssetB = assetA;
    sortedAmountA = amountB;
    sortedAmountB = amountA;
  }

  // Get liquidity pool details
  const lpAsset = new LiquidityPoolAsset(sortedAssetA, sortedAssetB, fee);
  let poolId = '';
  try {
    const { getLiquidityPoolId } = require('stellar-sdk');
    poolId = getLiquidityPoolId('constant_product', {
      assetA: sortedAssetA,
      assetB: sortedAssetB,
      fee
    }).toString('hex');
  } catch {
    poolId = (lpAsset as unknown as { getLiquidityPoolId?: () => string; poolId?: string }).getLiquidityPoolId?.() ||
      (lpAsset as unknown as { poolId?: string }).poolId || '';
  }

  const ratio = parseFloat(sortedAmountA) / parseFloat(sortedAmountB);
  const minPrice = (ratio * (1 - slippage)).toFixed(7);
  const maxPrice = (ratio * (1 + slippage)).toFixed(7);

  if (dryRun) {
    const dryResult: CliTransactionResult = {
      command: 'create-pool',
      network: networkName,
      status: 'dry-run',
      dryRun: true,
      transactionHash: null,
      ledger: null,
      explorerUrl: null,
      details: {
        horizonUrl,
        depositorAddress,
        poolId,
        fee,
        slippage,
        minPrice,
        maxPrice,
        assetA: sortedAssetA.isNative() ? 'XLM' : `${sortedAssetA.getCode()}:${sortedAssetA.getIssuer()}`,
        assetB: sortedAssetB.isNative() ? 'XLM' : `${sortedAssetB.getCode()}:${sortedAssetB.getIssuer()}`,
        amountA: sortedAmountA,
        amountB: sortedAmountB,
      },
    };
    console.log(formatTransactionResult(dryResult, jsonMode));
    return dryResult;
  }

  if (networkName === 'mainnet') {
    await confirmMainnetWrite('create-pool', options, deps);
  }

  if (!jsonMode) {
    console.log(`Connecting to Stellar network: ${networkName} via ${horizonUrl}...`);
    console.log(`Depositor Account: ${depositorAddress}`);
    console.log(`Liquidity Pool ID: ${poolId}`);
    console.log('Fetching account details...');
  }

  try {
    const server = new Horizon.Server(horizonUrl);
    const account = await server.loadAccount(depositorAddress);

    const hasTrustline = (asset: Asset) => {
      if (asset.isNative()) return true;
      return account.balances.some((b: any) =>
        b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer()
      );
    };

    const hasPoolTrustline = (pid: string) => {
      return account.balances.some((b: any) =>
        b.asset_type === 'liquidity_pool_shares' && b.liquidity_pool_id === pid
      );
    };

    const txBuilder = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: networkSettings.passphrase
    });

    let operationsAdded = 0;

    if (!hasTrustline(sortedAssetA)) {
      if (!jsonMode) {
        console.log(`Adding trustline for asset: ${sortedAssetA.getCode()}:${sortedAssetA.getIssuer()}...`);
      }
      txBuilder.addOperation(Operation.changeTrust({ asset: sortedAssetA }));
      operationsAdded++;
    }

    if (!hasTrustline(sortedAssetB)) {
      if (!jsonMode) {
        console.log(`Adding trustline for asset: ${sortedAssetB.getCode()}:${sortedAssetB.getIssuer()}...`);
      }
      txBuilder.addOperation(Operation.changeTrust({ asset: sortedAssetB }));
      operationsAdded++;
    }

    if (!hasPoolTrustline(poolId)) {
      if (!jsonMode) {
        console.log(`Adding trustline for pool shares: ${poolId}...`);
      }
      txBuilder.addOperation(Operation.changeTrust({ asset: lpAsset }));
      operationsAdded++;
    }

    if (!jsonMode) {
      console.log(`Depositing assets into pool:`);
      console.log(`  Asset A Amount: ${sortedAmountA}`);
      console.log(`  Asset B Amount: ${sortedAmountB}`);
      console.log(`  Min Price Ratio: ${minPrice}`);
      console.log(`  Max Price Ratio: ${maxPrice}`);
    }

    txBuilder.addOperation(
      Operation.liquidityPoolDeposit({
        liquidityPoolId: poolId,
        maxAmountA: sortedAmountA,
        maxAmountB: sortedAmountB,
        minPrice,
        maxPrice
      })
    );
    operationsAdded++;

    txBuilder.setTimeout(30);
    const tx = txBuilder.build();
    tx.sign(depositorKeypair);

    if (!jsonMode) {
      console.log(`Submitting transaction with ${operationsAdded} operations to network...`);
    }
    const response = await server.submitTransaction(tx);
    const ledger = (response as unknown as { ledger?: number | string }).ledger ?? 'pending';
    const txResult: CliTransactionResult = {
      command: 'create-pool',
      network: networkName,
      status: 'submitted',
      dryRun: false,
      transactionHash: response.hash,
      ledger,
      explorerUrl: buildExplorerUrl(networkName, response.hash),
      details: {
        poolId,
        operationsAdded,
        depositorAddress,
        minPrice,
        maxPrice,
      },
    };
    console.log(formatTransactionResult(txResult, jsonMode));
    return txResult;
  } catch (err: unknown) {
    if (err instanceof CliError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliNetworkError(`Pool creation transaction failed on ${networkName}: ${msg}`, {
      command: 'create-pool',
      network: networkName,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// liquidate command
// ─────────────────────────────────────────────────────────────────────────────

export async function runLiquidate(
  args: string[],
  deps: CliExecutionDeps = {}
): Promise<CliTransactionResult | void> {
  const options = parseArgs(args);
  const jsonMode = options['json'] === 'true';
  const dryRun = options['dry-run'] === 'true';
  const env = deps.env ?? process.env;

  if (args.includes('--help') || args.includes('-h')) {
    printLiquidateHelp(jsonMode);
    return;
  }

  const networkSettings = resolveNetworkSettings(options, env);
  if (!options['asset-id'] && networkSettings.contracts.rwaToken) {
    options['asset-id'] = networkSettings.contracts.rwaToken;
  }
  if (!options['custody-validator'] && networkSettings.contracts.custodyValidator) {
    options['custody-validator'] = networkSettings.contracts.custodyValidator;
  }

  const secret = resolveSecretValue(options, env);
  if (secret) {
    options['secret'] = secret;
  }

  const required = ['asset-id', 'custody-validator', 'secret', 'evidence-hash'];
  for (const req of required) {
    if (!options[req] || options[req] === 'true') {
      if (!jsonMode) {
        console.error(`Error: Missing required option --${req}`);
      }
      throw new CliValidationError(`Missing required option --${req}`);
    }
  }

  const assetId = options['asset-id'];
  const custodyValidatorId = options['custody-validator'];
  const reason = options['reason'] || 'undercollateralized';
  const evidenceHash = options['evidence-hash'];
  const networkName = networkSettings.network;
  const horizonUrl = networkSettings.horizonUrl;
  const force = options['force'] === 'true';

  const assetErr = validators.contractAddress(assetId);
  if (assetErr) throw new CliValidationError(`Invalid --asset-id: ${assetErr}`);
  const validatorErr = validators.contractAddress(custodyValidatorId);
  if (validatorErr) throw new CliValidationError(`Invalid --custody-validator: ${validatorErr}`);

  if (!/^[0-9a-fA-F]{64}$/.test(evidenceHash)) {
    throw new CliValidationError('--evidence-hash must be a 64-character hex string (32 bytes).');
  }

  let adminKeypair: Keypair;
  try {
    adminKeypair = Keypair.fromSecret(options['secret']);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliValidationError(`Invalid --secret key: ${msg}`);
  }

  if (dryRun) {
    const dryResult: CliTransactionResult = {
      command: 'liquidate',
      network: networkName,
      status: 'dry-run',
      dryRun: true,
      transactionHash: null,
      ledger: null,
      explorerUrl: null,
      details: {
        horizonUrl,
        adminAddress: adminKeypair.publicKey(),
        assetId,
        custodyValidatorId,
        reason,
        evidenceHash,
        force,
      },
    };
    console.log(formatTransactionResult(dryResult, jsonMode));
    return dryResult;
  }

  if (networkName === 'mainnet') {
    await confirmMainnetWrite('liquidate', options, deps);
  }

  if (!jsonMode) {
    console.log(`Connecting to Stellar network: ${networkName} via ${horizonUrl}...`);
    console.log(`Admin Account: ${adminKeypair.publicKey()}`);
    console.log(`Asset ID: ${assetId}`);
    console.log(`Custody Validator: ${custodyValidatorId}`);
  }

  const custodyClient = new CustodyClient(
    custodyValidatorId,
    horizonUrl,
    networkSettings.passphrase
  );

  if (!force) {
    if (!jsonMode) {
      console.log('\nChecking collateralization status...');
    }
    try {
      const backingStatus = await custodyClient.verifyAssetBacking(assetId);

      if (backingStatus.isValid) {
        const skippedResult: CliTransactionResult = {
          command: 'liquidate',
          network: networkName,
          status: 'skipped',
          dryRun: false,
          transactionHash: null,
          ledger: null,
          explorerUrl: null,
          details: {
            assetId,
            custodyValidatorId,
            reason: 'Asset is currently fully backed by valid custody attestation; use --force to liquidate anyway.',
          },
        };
        if (jsonMode) {
          console.log(formatTransactionResult(skippedResult, true));
        } else {
          console.log('✅ Asset is currently fully backed by valid custody attestation.');
          console.log('   Use --force to liquidate anyway.');
        }
        return skippedResult;
      }

      if (!jsonMode) {
        if (backingStatus.alerts.length > 0) {
          console.log('⚠️  Custody alerts detected:');
          for (const alert of backingStatus.alerts) {
            console.log(`    - ${alert}`);
          }
        }

        if (!backingStatus.latestAttestation) {
          console.log('⚠️  No valid attestation found — asset has no confirmed collateral backing.');
        } else {
          const expiredAt = new Date(backingStatus.latestAttestation.expiresAt);
          console.log(`⚠️  Latest attestation expired at: ${expiredAt.toISOString()}`);
          console.log(`   Insurance status: ${backingStatus.insuranceStatus}`);
        }

        console.log('\n🔴 Position is undercollateralized. Proceeding with liquidation...');
      }
    } catch (err: unknown) {
      if (!jsonMode) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Warning: Could not verify collateral on-chain (${msg}). Proceeding with liquidation as requested...`);
      }
    }
  } else if (!jsonMode) {
    console.log('⚡ --force flag set. Skipping collateralization check...');
  }

  if (!jsonMode) {
    console.log('\nTriggering insurance claim on Custody Validator...');
    console.log(`  Reason: ${reason}`);
    console.log(`  Evidence Hash: ${evidenceHash}`);
  }

  try {
    const result = await custodyClient.triggerInsuranceClaim(
      adminKeypair,
      assetId,
      reason,
      evidenceHash
    );
    const ledger = (result as unknown as { ledger?: number | string }).ledger ?? 'pending';
    const txResult: CliTransactionResult = {
      command: 'liquidate',
      network: networkName,
      status: 'submitted',
      dryRun: false,
      transactionHash: result.hash,
      ledger,
      explorerUrl: buildExplorerUrl(networkName, result.hash),
      details: {
        assetId,
        custodyValidatorId,
        reason,
        evidenceHash,
      },
    };
    console.log(formatTransactionResult(txResult, jsonMode));
    if (!jsonMode) {
      console.log('\nThe custody contract has emitted an "insurance_claim_triggered" event.');
      console.log('The insurance provider will now process the claim and compensate token holders.');
    }
    return txResult;
  } catch (err: unknown) {
    if (err instanceof CliError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliNetworkError(`Liquidation failed on ${networkName}: ${msg}`, {
      command: 'liquidate',
      network: networkName,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runCli(
  argv: string[] = process.argv.slice(2),
  deps: CliExecutionDeps = {}
): Promise<number> {
  const jsonMode = argv.includes('--json');

  if (argv.includes('--interactive') || argv.includes('-i')) {
    try {
      await runInteractive();
      return 0;
    } catch (err: unknown) {
      const code = err instanceof CliError ? err.exitCode : 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error('Interactive mode error:', message);
      return code;
    }
  }

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || (argv[0]?.startsWith('--') && (argv.includes('--help') || argv.includes('-h')))) {
    printHelp(jsonMode);
    return 0;
  }

  const command = argv[0];
  const commandArgs = argv.slice(1);

  try {
    if (command === 'create-pool') {
      await runCreatePool(commandArgs, deps);
      return 0;
    }
    if (command === 'liquidate') {
      await runLiquidate(commandArgs, deps);
      return 0;
    }
    if (command === 'generate-types') {
      await runGenerateTypes(commandArgs);
      return 0;
    }
    if (command === 'verify-contracts') {
      await runVerifyContracts(commandArgs, deps);
      return 0;
    }

    throw new CliValidationError(`Unknown command "${command}"`);
  } catch (err: unknown) {
    const exitCode = err instanceof CliError ? err.exitCode : 1;
    const errorCode = err instanceof CliError ? err.code : 'CLI_EXECUTION_ERROR';
    const message = err instanceof Error ? err.message : String(err);

    if (jsonMode) {
      console.error(
        JSON.stringify(
          {
            error: {
              code: errorCode,
              exitCode,
              message,
              ...(err instanceof CliError && err.details ? { details: err.details } : {}),
            },
          },
          null,
          2
        )
      );
    } else {
      console.error(`Error [${errorCode}]: ${message}`);
    }
    return exitCode;
  }
}

if (require.main === module) {
  runCli().then((code) => {
    process.exit(code);
  });
}
