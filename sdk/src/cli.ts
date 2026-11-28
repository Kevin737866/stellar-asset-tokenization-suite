import {
  Asset,
  LiquidityPoolAsset,
  Operation,
  TransactionBuilder,
  Keypair,
  Horizon
} from 'stellar-sdk';
import * as readline from 'readline';
import { STELLAR_NETWORKS } from './constants';
import { CustodyClient } from './custody';
import { runTypeGenerator } from './typeGenerator';

// ─────────────────────────────────────────────────────────────────────────────
// CLI errors and exit codes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base error for CLI failures that carry a process exit code.
 * Exit codes: 0 success, 1 unexpected, 2 validation, 4 network.
 */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = new.target.name;
    this.exitCode = exitCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Invalid or missing CLI input. Exits with code 2. */
export class CliValidationError extends CliError {
  constructor(message: string) {
    super(message, 2);
  }
}

/** Horizon/RPC/network request failure. Exits with code 4. */
export class CliNetworkError extends CliError {
  constructor(message: string) {
    super(message, 4);
  }
}

function cliErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Optional network seams for tests; production uses real Horizon servers. */
export interface CliDeps {
  createHorizonServer?: (
    horizonUrl: string
  ) => Pick<Horizon.Server, 'loadAccount' | 'submitTransaction'>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Asset utilities
// ─────────────────────────────────────────────────────────────────────────────

// Helper to parse asset string
function parseAsset(assetStr: string): Asset {
  if (assetStr.toUpperCase() === 'XLM' || assetStr.toUpperCase() === 'NATIVE') {
    return Asset.native();
  }
  const parts = assetStr.split(':');
  if (parts.length !== 2) {
    throw new CliValidationError(`Invalid asset format: "${assetStr}". Expected "XLM" or "CODE:ISSUER"`);
  }
  return new Asset(parts[0], parts[1]);
}

// Compare two assets lexicographically
function compareAssets(a: Asset, b: Asset): number {
  if (a.isNative() && b.isNative()) return 0;
  if (a.isNative()) return -1;
  if (b.isNative()) return 1;

  const codeCompare = a.getCode().localeCompare(b.getCode());
  if (codeCompare !== 0) return codeCompare;

  return a.getIssuer().localeCompare(b.getIssuer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Help text & examples
// ─────────────────────────────────────────────────────────────────────────────

export const SUPPORTED_COMMANDS = [
  'create-pool',
  'liquidate',
  'generate-types',
] as const;

export type CliCommand = (typeof SUPPORTED_COMMANDS)[number];

export const COMMAND_HELP_EXAMPLES: Record<CliCommand, readonly string[]> = {
  'create-pool': [
    'node dist/cli.js create-pool --asset-a XLM --asset-b USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN --amount-a 1000 --amount-b 500 --secret S... --network testnet',
    'node dist/cli.js create-pool --asset-a RWA:G... --asset-b USDC:G... --amount-a 250 --amount-b 250 --fee 30 --slippage 0.02 --secret S... --network mainnet --horizon-url https://horizon.stellar.org',
  ],
  liquidate: [
    'node dist/cli.js liquidate --asset-id C... --custody-validator C... --secret S... --evidence-hash 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --network testnet',
    'node dist/cli.js liquidate --asset-id C... --custody-validator C... --secret S... --evidence-hash 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --reason "attestation_expired" --force --network mainnet',
  ],
  'generate-types': [
    'node dist/cli.js generate-types --schema ./schemas/rwa-token.json --out ./src/generated/rwaToken.ts',
    'node dist/cli.js generate-types --contracts C...,C... --rpc-url https://soroban-testnet.stellar.org --network testnet --dry-run',
  ],
};

function formatExamples(examples: readonly string[]): string {
  return examples.map((example) => `  ${example}`).join('\n');
}

export function getHelpText(command?: string): string {
  if (command === undefined) {
    return `
Stellar RWA Suite CLI

Usage:
  node dist/cli.js <command> [options]
  node dist/cli.js --interactive
  node dist/cli.js -i

Commands:
  create-pool     Create and fund a Stellar liquidity pool
  liquidate       Liquidate an undercollateralized RWA position
  generate-types  Generate TypeScript types from Soroban contract schemas

Global Options:
  --interactive, -i   Launch guided interactive prompt mode
  --help,       -h    Show this help message

Run "node dist/cli.js <command> --help" for command-specific options.

Exit Codes:
  0  Success
  1  Unexpected error
  2  Validation or invalid input
  4  Network failure
`);
}

Usage:
  node dist/cli.js create-pool [options]

Options:
  --asset-a <asset>      First asset (e.g. "XLM" or "CODE:ISSUER") [required]
  --asset-b <asset>      Second asset (e.g. "CODE:ISSUER") [required]
  --amount-a <amount>    Maximum amount of Asset A to deposit [required]
  --amount-b <amount>    Maximum amount of Asset B to deposit [required]
  --fee <fee>            Liquidity pool fee in basis points (default: 30)
  --secret <secret>      Secret key of the depositor [required]
  --network <network>    Stellar network: testnet, mainnet, futurenet, standalone (default: testnet)
  --horizon-url <url>    Horizon server URL (optional, overrides default for network)
  --slippage <slippage>  Slippage tolerance as a decimal (default: 0.01 for 1%)
  --help, -h             Show this help message

Examples:
${formatExamples(COMMAND_HELP_EXAMPLES['create-pool'])}
`;
  }

  if (command === 'liquidate') {
    return `
Stellar RWA Suite CLI - Liquidate Command

Liquidates an undercollateralized RWA position by triggering an insurance claim
on the Custody Validator contract. The command first checks whether the position
is actually undercollateralized (collateral value < total token supply). Use
--force to skip the collateralization check and proceed unconditionally.

Usage:
  node dist/cli.js liquidate [options]

Options:
  --asset-id <address>          On-chain contract address of the RWA token [required]
  --custody-validator <address> Custody Validator contract address [required]
  --secret <secret>             Secret key of the authorized admin account [required]
  --reason <reason>             Short reason code for the claim (default: "undercollateralized")
  --evidence-hash <hash>        64-character hex evidence hash (32 bytes) [required]
  --network <network>           Stellar network: testnet, mainnet, futurenet, standalone (default: testnet)
  --horizon-url <url>           Horizon server URL (optional, overrides default for network)
  --force                       Skip collateralization check and liquidate unconditionally
  --help, -h                    Show this help message

Examples:
${formatExamples(COMMAND_HELP_EXAMPLES['liquidate'])}
`;
  }

  if (command === 'generate-types') {
    return `
Stellar RWA Suite CLI - Type Generator

Generates a TypeScript module from Soroban contract SCHEMA (spec) entries:
interfaces for structs, discriminated unions / enums for Soroban unions and
enums, and a <Name>Client interface with one method signature per contract
function. Map, Vec, Option, tuples, BytesN and custom structs/enums are all
handled. A warning is emitted for any generated type whose name collides with
a manually-maintained type.

Usage:
  npx rwa-sdk generate-types --contracts <id[,id...]> --rpc-url <url> [options]
  npx rwa-sdk generate-types --schema <file.json> [--schema <file.json>...] [options]

Options:
  --contracts <ids>       Comma-separated contract ids to fetch from the network
  --rpc-url <url>         Soroban RPC URL (required with --contracts)
  --network <network>     Network passphrase preset: testnet, mainnet, futurenet,
                          standalone (used with --contracts; default: testnet)
  --schema <file.json>    Local schema JSON file (repeatable; array of spec
                          entries or { "entries": [...] })
  --out <file.ts>         Write the generated module here (default: stdout)
  --manual-types <file>   Manual types module to diff generated names against
                          (default: sdk/src/types.ts when present)
  --no-client             Do not emit the <Name>Client interface
  --dry-run               Print the result and warnings without writing --out
  --help, -h              Show this help message

Examples:
${formatExamples(COMMAND_HELP_EXAMPLES['generate-types'])}
`;
  }

  throw new Error(
    `Unknown command: "${command}". Supported commands: ${SUPPORTED_COMMANDS.join(', ')}`
  );
}

export function printHelp() {
  console.log(getHelpText());
}

export function printGenerateTypesHelp() {
  console.log(getHelpText('generate-types'));
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

async function runGenerateTypes(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printGenerateTypesHelp();
    return;
  }

  const options = parseArgs(args);
  const contracts = (options['contracts'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const schemaFiles = collectRepeated(args, '--schema');
  if (options['schema'] && !schemaFiles.includes(options['schema']) && options['schema'] !== 'true') {
    schemaFiles.push(options['schema']);
  }

  if (contracts.length === 0 && schemaFiles.length === 0) {
    printGenerateTypesHelp();
    throw new CliValidationError('Provide --contracts <ids> or at least one --schema <file.json>');
  }

  const networkName = options['network'] || 'testnet';
  const networkConfig = STELLAR_NETWORKS[networkName];
  if (contracts.length > 0 && !networkConfig) {
    throw new CliValidationError(`Unsupported network: "${networkName}". Supported: testnet, mainnet, futurenet, standalone`);
  }

  let manualTypesFile = options['manual-types'];
  if (!manualTypesFile) {
    const candidate = require('path').join(__dirname, 'types.ts');
    if (require('fs').existsSync(candidate)) manualTypesFile = candidate;
  }

  let result;
  try {
    result = await runTypeGenerator({
      schemaFiles,
      contracts,
      rpcUrl: options['rpc-url'],
      networkPassphrase: networkConfig?.passphrase,
      outFile: options['out'],
      emitClient: options['no-client'] !== 'true',
      manualTypesFile,
      dryRun: options['dry-run'] === 'true',
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (contracts.length > 0) {
      throw new CliNetworkError(`Failed to fetch contract schemas: ${cliErrorMessage(error)}`);
    }
    throw error;
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

export function printCreatePoolHelp() {
  console.log(getHelpText('create-pool'));
}

export function printLiquidateHelp() {
  console.log(getHelpText('liquidate'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
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
    console.log(`  ℹ  ${description}`);
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
// create-pool command
// ─────────────────────────────────────────────────────────────────────────────

async function runCreatePool(args: string[], deps: CliDeps = {}): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printCreatePoolHelp();
    return;
  }

  const options = parseArgs(args);
  const required = ['asset-a', 'asset-b', 'amount-a', 'amount-b', 'secret'];
  for (const req of required) {
    if (!options[req]) {
      printCreatePoolHelp();
      throw new CliValidationError(`Missing required option --${req}`);
    }
  }

  const assetAStr = options['asset-a'];
  const assetBStr = options['asset-b'];
  const amountA = options['amount-a'];
  const amountB = options['amount-b'];
  const feeStr = options['fee'] || '30';
  const secret = options['secret'];
  const networkName = options['network'] || 'testnet';
  const slippageStr = options['slippage'] || '0.01';

  if (validators.positiveNumber(amountA) || validators.positiveNumber(amountB)) {
    throw new CliValidationError('Amounts must be positive numbers');
  }
  if (validators.feeBasicPoints(feeStr)) {
    throw new CliValidationError('Fee must be a whole number between 1 and 10000 basis points');
  }
  if (validators.slippage(slippageStr)) {
    throw new CliValidationError('Slippage must be between 0 and 1');
  }

  const fee = parseInt(feeStr, 10);
  const slippage = parseFloat(slippageStr);

  const networkConfig = STELLAR_NETWORKS[networkName];
  if (!networkConfig) {
    throw new CliValidationError(`Unsupported network: "${networkName}". Supported: testnet, mainnet, futurenet, standalone`);
  }

  const horizonUrl = options['horizon-url'] || networkConfig.horizonUrl;
  console.log(`Connecting to Stellar network: ${networkName} via ${horizonUrl}...`);
  let server: Pick<Horizon.Server, 'loadAccount' | 'submitTransaction'>;
  try {
    server = deps.createHorizonServer
      ? deps.createHorizonServer(horizonUrl)
      : new Horizon.Server(horizonUrl);
  } catch (error) {
    throw new CliValidationError(`Invalid --horizon-url "${horizonUrl}": ${cliErrorMessage(error)}`);
  }

  let depositorKeypair: Keypair;
  try {
    depositorKeypair = Keypair.fromSecret(secret);
  } catch (error) {
    throw new CliValidationError(`Invalid --secret key: ${cliErrorMessage(error)}`);
  }
  const depositorAddress = depositorKeypair.publicKey();
  console.log(`Depositor Account: ${depositorAddress}`);

  const assetA = parseAsset(assetAStr);
  const assetB = parseAsset(assetBStr);

  // Sort assets lexicographically
  let sortedAssetA = assetA;
  let sortedAssetB = assetB;
  let sortedAmountA = amountA;
  let sortedAmountB = amountB;

  if (compareAssets(assetA, assetB) > 0) {
    console.log('Swapping assets lexicographically (Asset A must be lexicographically smaller than Asset B in Stellar LP)...');
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
  } catch (e) {
    poolId = (lpAsset as any).getLiquidityPoolId?.() || (lpAsset as any).poolId || '';
  }
  console.log(`Liquidity Pool ID: ${poolId}`);

  // Load account to check balance and trustlines
  console.log('Fetching account details...');
  let account;
  try {
    account = await server.loadAccount(depositorAddress);
  } catch (error) {
    throw new CliNetworkError(`Failed to load account ${depositorAddress}: ${cliErrorMessage(error)}`);
  }

  // Check trustlines
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

  const networkPassphrase = networkConfig.passphrase;
  const txBuilder = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase
  });

  let operationsAdded = 0;

  // Add trustlines if missing
  if (!hasTrustline(sortedAssetA)) {
    console.log(`Adding trustline for asset: ${sortedAssetA.getCode()}:${sortedAssetA.getIssuer()}...`);
    txBuilder.addOperation(Operation.changeTrust({ asset: sortedAssetA }));
    operationsAdded++;
  }

  if (!hasTrustline(sortedAssetB)) {
    console.log(`Adding trustline for asset: ${sortedAssetB.getCode()}:${sortedAssetB.getIssuer()}...`);
    txBuilder.addOperation(Operation.changeTrust({ asset: sortedAssetB }));
    operationsAdded++;
  }

  if (!hasPoolTrustline(poolId)) {
    console.log(`Adding trustline for pool shares: ${poolId}...`);
    txBuilder.addOperation(Operation.changeTrust({ asset: lpAsset }));
    operationsAdded++;
  }

  // Calculate slippage-adjusted price bounds
  const ratio = parseFloat(sortedAmountA) / parseFloat(sortedAmountB);
  const minPrice = (ratio * (1 - slippage)).toFixed(7);
  const maxPrice = (ratio * (1 + slippage)).toFixed(7);

  console.log(`Depositing assets into pool:`);
  console.log(`  Asset A Amount: ${sortedAmountA}`);
  console.log(`  Asset B Amount: ${sortedAmountB}`);
  console.log(`  Min Price Ratio: ${minPrice}`);
  console.log(`  Max Price Ratio: ${maxPrice}`);

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

  console.log(`Submitting transaction with ${operationsAdded} operations to network...`);
  let response;
  try {
    response = await server.submitTransaction(tx);
  } catch (error) {
    throw new CliNetworkError(`Failed to submit transaction: ${cliErrorMessage(error)}`);
  }
  console.log('Transaction submitted successfully!');
  console.log(`Hash: ${response.hash}`);
  console.log(`Ledger: ${(response as any).ledger}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// liquidate command
// ─────────────────────────────────────────────────────────────────────────────

async function runLiquidate(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printLiquidateHelp();
    return;
  }

  const options = parseArgs(args);
  const required = ['asset-id', 'custody-validator', 'secret', 'evidence-hash'];
  for (const req of required) {
    if (!options[req]) {
      printLiquidateHelp();
      throw new CliValidationError(`Missing required option --${req}`);
    }
  }

  const assetId = options['asset-id'];
  const custodyValidatorId = options['custody-validator'];
  const secret = options['secret'];
  const reason = options['reason'] || 'undercollateralized';
  const evidenceHash = options['evidence-hash'];
  const networkName = options['network'] || 'testnet';
  const force = options['force'] === 'true';

  if (validators.contractAddress(assetId)) {
    throw new CliValidationError(`Invalid --asset-id: ${validators.contractAddress(assetId)}`);
  }
  if (validators.contractAddress(custodyValidatorId)) {
    throw new CliValidationError(`Invalid --custody-validator: ${validators.contractAddress(custodyValidatorId)}`);
  }

  // Validate evidence hash format
  if (!/^[0-9a-fA-F]{64}$/.test(evidenceHash)) {
    throw new CliValidationError('--evidence-hash must be a 64-character hex string (32 bytes).');
  }

  const networkConfig = STELLAR_NETWORKS[networkName];
  if (!networkConfig) {
    throw new CliValidationError(`Unsupported network: "${networkName}". Supported: testnet, mainnet, futurenet, standalone`);
  }

  const horizonUrl = options['horizon-url'] || networkConfig.horizonUrl;
  console.log(`Connecting to Stellar network: ${networkName} via ${horizonUrl}...`);

  let adminKeypair: Keypair;
  try {
    adminKeypair = Keypair.fromSecret(secret);
  } catch (error) {
    throw new CliValidationError(`Invalid --secret key: ${cliErrorMessage(error)}`);
  }
  console.log(`Admin Account: ${adminKeypair.publicKey()}`);
  console.log(`Asset ID: ${assetId}`);
  console.log(`Custody Validator: ${custodyValidatorId}`);

  // Instantiate CustodyClient
  const custodyClient = new CustodyClient(
    custodyValidatorId,
    horizonUrl,
    networkConfig.passphrase
  );

  // Check collateralization unless --force is set
  if (!force) {
    console.log('\nChecking collateralization status...');
    try {
      const backingStatus = await custodyClient.verifyAssetBacking(assetId);

      if (backingStatus.isValid) {
        console.log('✅ Asset is currently fully backed by valid custody attestation.');
        console.log('   Use --force to liquidate anyway.');
        return;
      }

      // Describe why the position is undercollateralized
      if (backingStatus.alerts.length > 0) {
        console.log(`⚠️  Custody alerts detected:`);
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
    } catch (err: unknown) {
      console.warn(`Warning: Could not verify collateral on-chain (${cliErrorMessage(err)}). Proceeding with liquidation as requested...`);
    }
  } else {
    console.log('⚡ --force flag set. Skipping collateralization check...');
  }

  // Trigger the insurance claim / liquidation
  console.log(`\nTriggering insurance claim on Custody Validator...`);
  console.log(`  Reason: ${reason}`);
  console.log(`  Evidence Hash: ${evidenceHash}`);

  let result;
  try {
    result = await custodyClient.triggerInsuranceClaim(
      adminKeypair,
      assetId,
      reason,
      evidenceHash
    );
  } catch (error) {
    throw new CliNetworkError(`Failed to trigger insurance claim: ${cliErrorMessage(error)}`);
  }

  console.log('\n✅ Liquidation triggered successfully!');
  console.log(`   Transaction Hash: ${result.hash}`);
  console.log(`   Ledger: ${(result as any).ledger ?? 'pending'}`);
  console.log('\nThe custody contract has emitted an "insurance_claim_triggered" event.');
  console.log('The insurance provider will now process the claim and compensate token holders.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the CLI and resolves to the exit code the process should use.
 *
 * Exit codes: 0 success, 1 unexpected, 2 validation, 4 network failure.
 * Kept as a return value (instead of calling process.exit internally) so the
 * behavior can be tested without terminating the test runner.
 */
export async function runCli(
  argv: string[] = process.argv.slice(2),
  deps: CliDeps = {}
): Promise<number> {
  const args = argv;

  // Interactive mode
  if (args.includes('--interactive') || args.includes('-i')) {
    try {
      await runInteractive();
      return 0;
    } catch (error) {
      const exitCode = error instanceof CliError ? error.exitCode : 1;
      console.error(`\n❌ Error [${exitCode}]: ${cliErrorMessage(error)}`);
      return exitCode;
    }
  }

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return 0;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  try {
    if (command === 'create-pool') {
      await runCreatePool(commandArgs, deps);
    } else if (command === 'liquidate') {
      await runLiquidate(commandArgs);
    } else if (command === 'generate-types') {
      await runGenerateTypes(commandArgs);
    } else {
      printHelp();
      throw new CliValidationError(`Unknown command: "${command}".`);
    }
    return 0;
  } catch (error) {
    const exitCode = error instanceof CliError ? error.exitCode : 1;
    console.error(`\n❌ Error [${exitCode}]: ${cliErrorMessage(error)}`);
    return exitCode;
  }
}

if (require.main === module) {
  runCli().then((code) => {
    process.exit(code);
  });
}
