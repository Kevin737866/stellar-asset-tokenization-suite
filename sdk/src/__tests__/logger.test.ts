import {
  createLogger,
  isSecretKey,
  Logger,
  REDACTED_VALUE,
  redactSecrets,
  redactStringValue,
} from '../logger';

const SAMPLE_STELLAR_SECRET =
  'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SAMPLE_STELLAR_PUBLIC =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const SAMPLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('logger secret redaction', () => {
  describe('isSecretKey', () => {
    it('identifies common secret-like field names across casing and separators', () => {
      const secretKeys = [
        'secret',
        'secretKey',
        'secret_key',
        'SECRET-KEY',
        'clientSecret',
        'password',
        'user_password',
        'passwd',
        'pwd',
        'passphrase',
        'walletPassphrase',
        'apiKey',
        'api_key',
        'API-KEY',
        'privateKey',
        'private_key',
        'privKey',
        'signingKey',
        'encryptionKey',
        'accessToken',
        'access_token',
        'refreshToken',
        'authToken',
        'bearerToken',
        'apiToken',
        'sessionToken',
        'idToken',
        'csrfToken',
        'authorization',
        'Authorization',
        'X-Auth-Token',
        'cookie',
        'set-cookie',
        'sessionId',
        'credential',
        'credentials',
        'mnemonic',
        'seed',
        'seedPhrase',
        'jwt',
        'signature',
      ];

      for (const key of secretKeys) {
        expect(isSecretKey(key)).toBe(true);
      }
    });

    it('preserves benign Stellar RWA domain keys', () => {
      const benignKeys = [
        'token',
        'tokenAddress',
        'tokenId',
        'tokenSymbol',
        'tokenName',
        'networkPassphrase',
        'contractId',
        'address',
        'amount',
        'hash',
        'txHash',
        'orderId',
        'trader',
        'serverUrl',
        'network',
      ];

      for (const key of benignKeys) {
        expect(isSecretKey(key)).toBe(false);
      }
    });

    it('supports additionalKeys and handles empty strings', () => {
      expect(isSecretKey('')).toBe(false);
      expect(isSecretKey('customField')).toBe(false);
      expect(isSecretKey('customField', ['custom_field'])).toBe(true);
    });
  });

  describe('redactStringValue', () => {
    it('redacts Stellar secret seeds while preserving public keys', () => {
      const input = `signer=${SAMPLE_STELLAR_PUBLIC} seed=${SAMPLE_STELLAR_SECRET}`;
      const output = redactStringValue(input);
      expect(output).toContain(SAMPLE_STELLAR_PUBLIC);
      expect(output).not.toContain(SAMPLE_STELLAR_SECRET);
      expect(output).toContain(`seed=${REDACTED_VALUE}`);
    });

    it('redacts Bearer tokens, JWTs, PEM private keys, and URL credentials', () => {
      expect(redactStringValue('Bearer abc123.def456')).toBe(
        `Bearer ${REDACTED_VALUE}`,
      );
      expect(redactStringValue(`token=${SAMPLE_JWT}`)).toBe(
        `token=${REDACTED_VALUE}`,
      );
      expect(
        redactStringValue(
          '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEF\n-----END PRIVATE KEY-----',
        ),
      ).toBe(REDACTED_VALUE);
      expect(
        redactStringValue('https://alice:s3cr3t@rpc.stellar.org/soroban'),
      ).toBe(`https://${REDACTED_VALUE}@rpc.stellar.org/soroban`);
    });
  });

  describe('redactSecrets', () => {
    it('recursively redacts nested objects and arrays without mutating input', () => {
      const input = {
        trader: SAMPLE_STELLAR_PUBLIC,
        token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        config: {
          apiKey: 'sk_live_12345',
          nested: [{ password: 'hunter2', amount: '100' }],
        },
        note: `leaked ${SAMPLE_STELLAR_SECRET}`,
      };
      const snapshot = JSON.parse(JSON.stringify(input));

      const redacted = redactSecrets(input);

      expect(redacted).toEqual({
        trader: SAMPLE_STELLAR_PUBLIC,
        token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        config: {
          apiKey: REDACTED_VALUE,
          nested: [{ password: REDACTED_VALUE, amount: '100' }],
        },
        note: `leaked ${REDACTED_VALUE}`,
      });
      // Original object must not be mutated
      expect(input).toEqual(snapshot);
    });

    it('handles circular references safely', () => {
      const circular: Record<string, unknown> = {
        name: 'node',
        secretKey: 'top-secret',
      };
      circular.self = circular;

      const redacted = redactSecrets(circular);
      expect(redacted.name).toBe('node');
      expect(redacted.secretKey).toBe(REDACTED_VALUE);
      expect(redacted.self).toBe('[Circular]');
    });

    it('sanitizes Error instances, Maps, Sets, and preserves primitives and Dates', () => {
      const err = new Error(`Failed with seed ${SAMPLE_STELLAR_SECRET}`) as Error & {
        apiKey?: string;
      };
      err.apiKey = 'my-secret-api-key';

      const map = new Map<string, unknown>([
        ['password', 'p@ss'],
        ['publicKey', SAMPLE_STELLAR_PUBLIC],
      ]);
      const set = new Set<string>([SAMPLE_STELLAR_SECRET, 'safe']);
      const now = new Date('2026-01-01T00:00:00.000Z');

      const redacted = redactSecrets({
        err,
        map,
        set,
        now,
        count: 42,
        empty: null,
        missing: undefined,
      }) as Record<string, any>;

      expect(redacted.err.message).toBe(`Failed with seed ${REDACTED_VALUE}`);
      expect(redacted.err.apiKey).toBe(REDACTED_VALUE);
      expect(err.message).toContain(SAMPLE_STELLAR_SECRET); // original Error untouched
      expect(redacted.map).toEqual({
        password: REDACTED_VALUE,
        publicKey: SAMPLE_STELLAR_PUBLIC,
      });
      expect(redacted.set).toEqual([REDACTED_VALUE, 'safe']);
      expect(redacted.now).toBe(now);
      expect(redacted.count).toBe(42);
      expect(redacted.empty).toBeNull();
      expect(redacted.missing).toBeUndefined();
    });

    it('respects custom replacement, additionalKeys, and redactValues=false', () => {
      const data = {
        internalPin: '9999',
        note: `seed=${SAMPLE_STELLAR_SECRET}`,
      };

      const redacted = redactSecrets(data, {
        additionalKeys: ['internalPin'],
        replacement: '***',
        redactValues: false,
      });

      expect(redacted).toEqual({
        internalPin: '***',
        note: `seed=${SAMPLE_STELLAR_SECRET}`,
      });
    });
  });

  describe('Logger integration', () => {
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;
    let debugSpy: jest.SpyInstance;

    beforeEach(() => {
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('redacts secret fields and secret message patterns across all log levels', () => {
      const logger = createLogger('TestComponent', 'debug');

      logger.debug(`Debug ${SAMPLE_STELLAR_SECRET}`, {
        secretKey: SAMPLE_STELLAR_SECRET,
        token: 'CTOKEN123',
      });
      logger.info('Info log', {
        headers: { Authorization: `Bearer ${SAMPLE_JWT}` },
        networkPassphrase: 'Test SDF Network ; September 2015',
      });
      logger.warn('Warn log', { password: 'secret-password' });
      logger.error('Error log', {
        rpcUrl: 'https://user:pass@rpc.example.com',
      });

      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy.mock.calls[0][0]).toContain(`Debug ${REDACTED_VALUE}`);
      expect(debugSpy.mock.calls[0][0]).not.toContain(SAMPLE_STELLAR_SECRET);
      expect(debugSpy.mock.calls[0][1]).toEqual({
        secretKey: REDACTED_VALUE,
        token: 'CTOKEN123',
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][1]).toEqual({
        headers: { Authorization: REDACTED_VALUE },
        networkPassphrase: 'Test SDF Network ; September 2015',
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][1]).toEqual({ password: REDACTED_VALUE });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][1]).toEqual({
        rpcUrl: `https://${REDACTED_VALUE}@rpc.example.com`,
      });
    });

    it('respects minLevel filtering and custom redactOptions', () => {
      const logger = new Logger('CustomLogger', 'warn', {
        additionalKeys: ['taxId'],
        replacement: '[MASKED]',
      });

      logger.info('Suppressed info', { taxId: '123-45-6789' });
      logger.warn('Visible warn', { taxId: '123-45-6789', amount: '50' });

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][1]).toEqual({
        taxId: '[MASKED]',
        amount: '50',
      });
    });
  });
});
