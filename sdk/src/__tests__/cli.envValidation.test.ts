/**
 * Regression tests for pre-network environment variable validation (issue #411).
 */

jest.mock('../custody', () => ({ CustodyClient: jest.fn() }));

import {
  CliDeps,
  MissingEnvironmentVariableError,
  resolveSecretValue,
  runCli,
  validateRequiredEnv,
} from '../cli';

const VALID_SECRET = 'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
const VALID_ADDRESS = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
const VALID_HASH = 'a'.repeat(64);

const mockCreateHorizonServer = jest.fn();
const mockCreateCustodyClient = jest.fn();

function createPoolArgs(extra: string[] = []): string[] {
  return [
    'create-pool',
    '--asset-a', 'XLM',
    '--asset-b', `USDC:${VALID_ADDRESS}`,
    '--amount-a', '100',
    '--amount-b', '200',
    ...extra,
  ];
}

function liquidateArgs(extra: string[] = []): string[] {
  return [
    'liquidate',
    '--asset-id', VALID_ADDRESS,
    '--custody-validator', VALID_ADDRESS,
    '--evidence-hash', VALID_HASH,
    '--force', 'true',
    ...extra,
  ];
}

function depsFor(env: NodeJS.ProcessEnv): CliDeps {
  return {
    env,
    createHorizonServer: mockCreateHorizonServer as never,
    createCustodyClient: mockCreateCustodyClient as never,
  };
}

let exitSpy: jest.SpyInstance;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  mockCreateHorizonServer.mockImplementation(() => {
    throw new Error('stop after network seam');
  });
  mockCreateCustodyClient.mockImplementation(() => {
    throw new Error('stop after network seam');
  });
});

afterEach(() => {
  exitSpy.mockRestore();
});

describe('validateRequiredEnv()', () => {
  it('returns trimmed values for present variables', () => {
    expect(
      validateRequiredEnv(
        [
          { name: 'STELLAR_SECRET', description: 'Signing secret' },
          { name: 'SATS_CLI_CONFIG', description: 'Config path' },
        ],
        { STELLAR_SECRET: `  ${VALID_SECRET}  `, SATS_CLI_CONFIG: ' config.json ' }
      )
    ).toEqual({
      STELLAR_SECRET: VALID_SECRET,
      SATS_CLI_CONFIG: 'config.json',
    });
  });

  it('rejects missing and blank variables before returning any values', () => {
    expect(() =>
      validateRequiredEnv(
        [
          { name: 'STELLAR_SECRET', description: 'Signing secret' },
          { name: 'SATS_CLI_CONFIG', description: 'Config path' },
        ],
        { STELLAR_SECRET: '   ' }
      )
    ).toThrow(MissingEnvironmentVariableError);

    try {
      validateRequiredEnv([{ name: 'STELLAR_SECRET', description: 'Signing secret' }], {});
      throw new Error('expected failure');
    } catch (error) {
      expect((error as MissingEnvironmentVariableError).missing).toEqual(['STELLAR_SECRET']);
    }
  });
});

describe('resolveSecretValue()', () => {
  it('reads STELLAR_SECRET by default with --secret-env', () => {
    expect(
      resolveSecretValue({ 'secret-env': 'true' }, { STELLAR_SECRET: VALID_SECRET })
    ).toBe(VALID_SECRET);
  });

  it('reads a custom variable name with --secret-env', () => {
    expect(resolveSecretValue({ 'secret-env': 'ADMIN_KEY' }, { ADMIN_KEY: VALID_SECRET })).toBe(
      VALID_SECRET
    );
  });

  it('reads an env:NAME reference in --secret', () => {
    expect(resolveSecretValue({ secret: 'env:ADMIN_KEY' }, { ADMIN_KEY: VALID_SECRET })).toBe(
      VALID_SECRET
    );
  });

  it('passes literal secrets through unchanged', () => {
    expect(resolveSecretValue({ secret: VALID_SECRET }, {})).toBe(VALID_SECRET);
    expect(resolveSecretValue({}, {})).toBeUndefined();
  });

  it('rejects empty env references and blank env values', () => {
    expect(() => resolveSecretValue({ secret: 'env:' }, {})).toThrow(/env:/);
    expect(() => resolveSecretValue({ 'secret-env': 'STELLAR_SECRET' }, { STELLAR_SECRET: ' ' })).toThrow(
      MissingEnvironmentVariableError
    );
  });
});

describe('runCli() pre-network validation', () => {
  it('fails create-pool with --secret-env before building a Horizon client', async () => {
    await runCli(createPoolArgs(['--secret-env']), depsFor({}));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockCreateHorizonServer).not.toHaveBeenCalled();
  });

  it('fails create-pool with an env: reference before building a Horizon client', async () => {
    await runCli(createPoolArgs(['--secret', 'env:MISSING_SECRET']), depsFor({}));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockCreateHorizonServer).not.toHaveBeenCalled();
  });

  it('builds a Horizon client after --secret-env is satisfied', async () => {
    await runCli(createPoolArgs(['--secret-env']), depsFor({ STELLAR_SECRET: VALID_SECRET }));
    expect(mockCreateHorizonServer).toHaveBeenCalledTimes(1);
  });

  it('fails liquidate with --secret-env before building a CustodyClient', async () => {
    await runCli(liquidateArgs(['--secret-env']), depsFor({}));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockCreateCustodyClient).not.toHaveBeenCalled();
  });

  it('builds a CustodyClient after --secret-env is satisfied', async () => {
    await runCli(liquidateArgs(['--secret-env']), depsFor({ STELLAR_SECRET: VALID_SECRET }));
    expect(mockCreateCustodyClient).toHaveBeenCalledTimes(1);
  });

  it('keeps literal --secret behavior without any environment variables', async () => {
    await runCli(createPoolArgs(['--secret', VALID_SECRET]), depsFor({}));
    expect(mockCreateHorizonServer).toHaveBeenCalledTimes(1);
  });
});
