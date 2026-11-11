/**
 * Regression tests for CLI enhancements (#408-#417):
 * - JSON output for read-only and write commands
 * - Help examples for every supported command
 * - Network profile loading from JSON config file
 * - Pre-network environment variable validation
 * - Dry-run mode for create-pool and liquidate
 * - Explicit mainnet write confirmation guard
 * - Non-zero exit codes for validation, authorization, and network errors
 * - Structured transaction identifier output
 * - verify-contracts command (offline & online endpoint checks)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { Horizon } from 'stellar-sdk';
import { CustodyClient } from '../custody';
import {
  CliAuthorizationError,
  CliNetworkError,
  CliValidationError,
  getCliHelpText,
  loadNetworkProfile,
  runCli,
  runCreatePool,
  runLiquidate,
  runVerifyContracts,
  validateRequiredEnv,
  verifyContractEntries,
} from '../cli';

jest.mock('../custody');

const VALID_SECRET = 'SCZANGBA5YHTNYVVV4C3U252E2B6P6F5T3U6MM63WBSBZATAQI3EBTQ4';
const VALID_CONTRACT_A = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const VALID_CONTRACT_B = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4';
const VALID_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const VALID_HASH = 'a'.repeat(64);

function createMockRl(answers: string[]): readline.Interface {
  let idx = 0;
  return {
    question: jest.fn((_q: string, cb: (answer: string) => void) => {
      cb(answers[idx++] ?? '');
    }),
    close: jest.fn(),
  } as unknown as readline.Interface;
}

describe('CLI enhancements (#408-#417)', () => {
  const tempDirs: string[] = [];
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempConfig(obj: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sats-cli-test-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'sats.config.json');
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
    return file;
  }

  describe('#409 & #417 Help examples and documentation', () => {
    it('includes usage and runnable Examples for every supported command', () => {
      for (const cmd of [undefined, 'create-pool', 'liquidate', 'generate-types', 'verify-contracts']) {
        const help = getCliHelpText(cmd);
        expect(help).toContain('Usage:');
        expect(help).toContain('Examples:');
      }
    });

    it('outputs machine-readable JSON for --help --json (#408)', async () => {
      const exitCode = await runCli(['--help', '--json']);
      expect(exitCode).toBe(0);
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      const parsed = JSON.parse(output);
      expect(parsed.commands).toEqual(
        expect.arrayContaining(['create-pool', 'liquidate', 'generate-types', 'verify-contracts'])
      );
      expect(parsed.defaultNetwork).toBe('testnet');
    });
  });

  describe('#410 Network profile selection from config file', () => {
    it('loads named profile, custom horizonUrl, rpcUrl, and contract defaults', () => {
      const cfgPath = makeTempConfig({
        defaultProfile: 'staging',
        profiles: {
          staging: {
            network: 'testnet',
            horizonUrl: 'https://horizon-testnet.stellar.org',
            rpcUrl: 'https://soroban-testnet.stellar.org',
            contracts: {
              rwaToken: VALID_CONTRACT_A,
              custodyValidator: VALID_CONTRACT_B,
            },
          },
          prod: {
            network: 'mainnet',
            horizonUrl: 'https://horizon.stellar.org',
          },
        },
      });

      const staging = loadNetworkProfile(cfgPath);
      expect(staging.profile).toBe('staging');
      expect(staging.network).toBe('testnet');
      expect(staging.contracts.rwaToken).toBe(VALID_CONTRACT_A);

      const prod = loadNetworkProfile(cfgPath, 'prod');
      expect(prod.network).toBe('mainnet');
      expect(prod.horizonUrl).toBe('https://horizon.stellar.org');
    });

    it('rejects unknown profile names or invalid JSON with CliValidationError', () => {
      const cfgPath = makeTempConfig({ profiles: { testnet: { network: 'testnet' } } });
      expect(() => loadNetworkProfile(cfgPath, 'missing')).toThrow(CliValidationError);
      expect(() => loadNetworkProfile(path.join(os.tmpdir(), 'does-not-exist.json'))).toThrow(
        CliValidationError
      );
    });
  });

  describe('#411 Environment variable pre-validation', () => {
    it('validates required env vars before making any network calls', async () => {
      expect(() =>
        validateRequiredEnv([{ name: 'STELLAR_SECRET', description: 'Signing secret' }], {})
      ).toThrow(CliValidationError);

      const exitCode = await runCli(
        [
          'create-pool',
          '--asset-a',
          'XLM',
          '--asset-b',
          `USDC:${VALID_ACCOUNT}`,
          '--amount-a',
          '100',
          '--amount-b',
          '10',
          '--secret-env',
        ],
        { env: {} }
      );
      expect(exitCode).toBe(2);
      expect(Horizon.Server).not.toHaveBeenCalled();
    });
  });

  describe('#412 & #415 Dry-run mode & structured transaction output', () => {
    it('runs create-pool --dry-run --json without submitting to Horizon', async () => {
      const res = await runCreatePool(
        [
          '--asset-a',
          'XLM',
          '--asset-b',
          `USDC:${VALID_ACCOUNT}`,
          '--amount-a',
          '100',
          '--amount-b',
          '25',
          '--secret-env',
          '--dry-run',
          '--json',
        ],
        { env: { STELLAR_SECRET: VALID_SECRET } }
      );

      expect(res).toBeDefined();
      expect(res!.dryRun).toBe(true);
      expect(res!.status).toBe('dry-run');
      expect(res!.transactionHash).toBeNull();
      expect(Horizon.Server).not.toHaveBeenCalled();

      const printed = JSON.parse(logSpy.mock.calls[0][0]);
      expect(printed.command).toBe('create-pool');
      expect(printed.dryRun).toBe(true);
    });

    it('emits structured transaction hash, ledger, and explorer URL on live create-pool', async () => {
      const res = await runCreatePool(
        [
          '--asset-a',
          'XLM',
          '--asset-b',
          `USDC:${VALID_ACCOUNT}`,
          '--amount-a',
          '100',
          '--amount-b',
          '25',
          '--secret',
          VALID_SECRET,
          '--json',
        ]
      );

      expect(res!.status).toBe('submitted');
      expect(res!.transactionHash).toBe('testhash');
      expect(res!.ledger).toBe(123);
      expect(res!.explorerUrl).toBe('https://stellar.expert/explorer/testnet/tx/testhash');
    });

    it('supports dry-run for liquidate loaded from --config without invoking CustodyClient', async () => {
      const cfgPath = makeTempConfig({
        profiles: {
          testnet: {
            network: 'testnet',
            contracts: {
              rwaToken: VALID_CONTRACT_A,
              custodyValidator: VALID_CONTRACT_B,
            },
          },
        },
      });

      const res = await runLiquidate(
        [
          '--config',
          cfgPath,
          '--secret',
          VALID_SECRET,
          '--evidence-hash',
          VALID_HASH,
          '--dry-run',
          '--json',
        ]
      );

      expect(res!.dryRun).toBe(true);
      expect(res!.details.assetId).toBe(VALID_CONTRACT_A);
      expect(CustodyClient).not.toHaveBeenCalled();
    });
  });

  describe('#413 Mainnet write confirmation guard', () => {
    it('blocks mainnet writes in non-interactive mode unless --confirm-mainnet is passed', async () => {
      const exitCode = await runCli([
        'create-pool',
        '--network',
        'mainnet',
        '--asset-a',
        'XLM',
        '--asset-b',
        `USDC:${VALID_ACCOUNT}`,
        '--amount-a',
        '10',
        '--amount-b',
        '10',
        '--secret',
        VALID_SECRET,
      ]);

      expect(exitCode).toBe(3);
      expect(Horizon.Server).not.toHaveBeenCalled();
    });

    it('aborts when interactive mainnet confirmation does not match MAINNET', async () => {
      await expect(
        runCreatePool(
          [
            '--network',
            'mainnet',
            '--asset-a',
            'XLM',
            '--asset-b',
            `USDC:${VALID_ACCOUNT}`,
            '--amount-a',
            '10',
            '--amount-b',
            '10',
            '--secret',
            VALID_SECRET,
          ],
          { confirmRl: createMockRl(['yes']) }
        )
      ).rejects.toThrow(CliAuthorizationError);
      expect(Horizon.Server).not.toHaveBeenCalled();
    });

    it('allows mainnet write when user types exact MAINNET or passes --confirm-mainnet', async () => {
      const res = await runCreatePool(
        [
          '--network',
          'mainnet',
          '--asset-a',
          'XLM',
          '--asset-b',
          `USDC:${VALID_ACCOUNT}`,
          '--amount-a',
          '10',
          '--amount-b',
          '10',
          '--secret',
          VALID_SECRET,
        ],
        { confirmRl: createMockRl(['MAINNET']) }
      );
      expect(res!.network).toBe('mainnet');
      expect(res!.explorerUrl).toBe('https://stellar.expert/explorer/public/tx/testhash');
    });
  });

  describe('#414 Non-zero exit codes on validation & network failures', () => {
    it('returns non-zero exit code 2 for validation errors and 4 for network errors', async () => {
      expect(await runCli(['unknown-cmd'])).toBe(2);
      expect(
        await runCli([
          'liquidate',
          '--asset-id',
          VALID_CONTRACT_A,
          '--custody-validator',
          VALID_CONTRACT_B,
          '--secret',
          VALID_SECRET,
          '--evidence-hash',
          'short',
        ])
      ).toBe(2);

      (CustodyClient as jest.Mock).mockImplementationOnce(() => ({
        verifyAssetBacking: jest.fn().mockRejectedValue(new Error('rpc offline')),
        triggerInsuranceClaim: jest.fn().mockRejectedValue(new Error('Horizon 504 timeout')),
      }));

      const netCode = await runCli([
        'liquidate',
        '--asset-id',
        VALID_CONTRACT_A,
        '--custody-validator',
        VALID_CONTRACT_B,
        '--secret',
        VALID_SECRET,
        '--evidence-hash',
        VALID_HASH,
        '--force',
      ]);
      expect(netCode).toBe(4);
    });
  });

  describe('#416 & #408 verify-contracts command', () => {
    it('verifies valid contracts from --config and outputs JSON report', async () => {
      const cfgPath = makeTempConfig({
        profiles: {
          testnet: {
            network: 'testnet',
            rpcUrl: 'https://soroban-testnet.stellar.org',
            contracts: {
              rwaToken: VALID_CONTRACT_A,
              custodyValidator: VALID_CONTRACT_B,
            },
          },
        },
      });

      const report = await runVerifyContracts(
        ['--config', cfgPath, '--check-rpc', '--json'],
        { checkEndpoint: jest.fn().mockResolvedValue(true) }
      );

      expect(report.allValid).toBe(true);
      expect(report.total).toBe(2);
      expect(report.checkedOnline).toBe(true);

      const printed = JSON.parse(logSpy.mock.calls[0][0]);
      expect(printed.allValid).toBe(true);
      expect(printed.contracts).toHaveLength(2);
    });

    it('rejects malformed contract addresses and surfaces CliNetworkError on unreachable RPC', async () => {
      const entries = verifyContractEntries(
        [
          { name: 'good', address: VALID_CONTRACT_A },
          { name: 'acct', address: VALID_ACCOUNT },
          { name: 'bad', address: 'INVALID_ID' },
        ],
        'testnet'
      );
      expect(entries[0].valid).toBe(true);
      expect(entries[1].valid).toBe(false);
      expect(entries[2].valid).toBe(false);

      expect(await runCli(['verify-contracts', '--contracts', 'BAD_CONTRACT_ID', '--json'])).toBe(2);

      await expect(
        runVerifyContracts(['--contracts', VALID_CONTRACT_A, '--check-rpc'], {
          checkEndpoint: jest.fn().mockResolvedValue(false),
        })
      ).rejects.toThrow(CliNetworkError);
    });
  });
});
