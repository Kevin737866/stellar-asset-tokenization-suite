/**
 * Regression tests for sdk-core enhancements (#388-#397):
 * - Exact decimal parsing/formatting without JS number rounding (#388)
 * - Typed network config validation before client creation (#389)
 * - Typed contract invocation failure wrapper (#390)
 * - Shared request timeout configuration & enforcement (#391)
 * - AbortSignal cancellation for read-only operations (#392)
 * - Secret-like field redaction in structured SDK logs (#393)
 * - Stable Soroban simulation failure error codes (#394)
 * - Network-scoped contract address validation (#395)
 * - Typed SDK capability and feature support query (#396)
 * - Runtime requirements & network documentation constants (#397)
 */

import { STELLAR_NETWORKS } from '../constants';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  SDK_NETWORK_DOCUMENTATION,
  SDK_RUNTIME_REQUIREMENTS,
  SOROBAN_SIMULATION_ERROR_CODES,
  classifySimulationFailure,
  executeReadWithAbort,
  getSDKCapabilities,
  invokeContractSafely,
  resolveRequestTimeoutMs,
  validateContractAddressForNetwork,
  validateTypedNetworkConfig,
  withRequestTimeout,
} from '../core';
import { ContractError, InvalidParametersError, NetworkError, TimeoutError } from '../errors';
import { createLogger, REDACTED_VALUE, redactSensitiveFields } from '../logger';
import { formatExactDecimal, parseExactDecimal } from '../validation';

const VALID_CONTRACT_TESTNET = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const VALID_CONTRACT_MAINNET = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4';
const VALID_SECRET = 'SCZANGBA5YHTNYVVV4C3U252E2B6P6F5T3U6MM63WBSBZATAQI3EBTQ4';

describe('sdk-core enhancements (#388-#397)', () => {
  describe('#388 Exact decimal parsing without JS float rounding', () => {
    it('parses high-precision decimals and large integers losslessly', () => {
      const a = parseExactDecimal('0.1', 7);
      const b = parseExactDecimal('0.2', 7);
      expect(a.scaled + b.scaled).toBe(3_000_000n);
      expect(formatExactDecimal(a.scaled + b.scaled, 7)).toBe('0.3');

      const huge = parseExactDecimal('9007199254740993.1234567', 7);
      expect(huge.scaled).toBe(90071992547409931234567n);
      expect(huge.normalized).toBe('9007199254740993.1234567');
    });

    it('rejects excess fractional precision, scientific notation, and negative/zero by default', () => {
      expect(() => parseExactDecimal('1.12345678', 7)).toThrow(InvalidParametersError);
      expect(() => parseExactDecimal('1e10', 7)).toThrow(InvalidParametersError);
      expect(() => parseExactDecimal('-5', 7)).toThrow(InvalidParametersError);
      expect(() => parseExactDecimal('0', 7)).toThrow(InvalidParametersError);
    });
  });

  describe('#389 Typed network configuration validation', () => {
    it('validates network, HTTP(S) URLs, passphrase, and timeout bounds', () => {
      const res = validateTypedNetworkConfig(
        {
          network: 'testnet',
          serverUrl: 'https://soroban-testnet.stellar.org',
          horizonUrl: STELLAR_NETWORKS.testnet.horizonUrl,
          passphrase: STELLAR_NETWORKS.testnet.passphrase,
          requestTimeoutMs: 15_000,
        },
        { requireMatchingPassphrase: true }
      );
      expect(res.valid).toBe(true);
      expect(res.requestTimeoutMs).toBe(15_000);
    });

    it('rejects unsupported networks, non-http schemes, and passphrase mismatches', () => {
      expect(() =>
        validateTypedNetworkConfig({
          network: 'devnet' as 'testnet',
          serverUrl: 'https://example.org',
          passphrase: 'x',
        })
      ).toThrow(InvalidParametersError);

      expect(() =>
        validateTypedNetworkConfig({
          network: 'testnet',
          serverUrl: 'ftp://invalid-scheme.org',
          passphrase: STELLAR_NETWORKS.testnet.passphrase,
        })
      ).toThrow(InvalidParametersError);

      expect(() =>
        validateTypedNetworkConfig(
          {
            network: 'mainnet',
            serverUrl: 'https://horizon.stellar.org',
            passphrase: STELLAR_NETWORKS.testnet.passphrase,
          },
          { requireMatchingPassphrase: true }
        )
      ).toThrow(InvalidParametersError);
    });
  });

  describe('#390 Typed contract invocation result wrapper', () => {
    it('wraps success and classified failures without losing retryable metadata', async () => {
      const ok = await invokeContractSafely(async () => ({ minted: 100n }));
      expect(ok).toEqual({ ok: true, value: { minted: 100n } });

      const timeoutFail = await invokeContractSafely(async () => {
        throw new TimeoutError('RPC timeout');
      });
      expect(timeoutFail.ok).toBe(false);
      if (!timeoutFail.ok) {
        expect(timeoutFail.failure.category).toBe('timeout');
        expect(timeoutFail.failure.retryable).toBe(true);
      }

      const contractFail = await invokeContractSafely(async () => {
        throw new ContractError('HostError: Error(Contract, #12)');
      });
      expect(contractFail.ok).toBe(false);
      if (!contractFail.ok) {
        expect(contractFail.failure.simulation?.code).toBe(
          SOROBAN_SIMULATION_ERROR_CODES.CONTRACT_TRAP
        );
        expect(contractFail.failure.simulation?.contractErrorNumber).toBe(12);
      }
    });
  });

  describe('#391 Shared request timeout configuration', () => {
    it('resolves timeouts consistently and enforces timeout deadlines', async () => {
      expect(resolveRequestTimeoutMs()).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
      expect(resolveRequestTimeoutMs(undefined, { defaultTimeout: 12 })).toBe(12_000);
      expect(() => resolveRequestTimeoutMs(50)).toThrow(InvalidParametersError);

      await expect(
        withRequestTimeout(
          () => new Promise((resolve) => setTimeout(() => resolve('late'), 250)),
          100,
          'slowCall'
        )
      ).rejects.toThrow(TimeoutError);
    });
  });

  describe('#392 AbortSignal support for read-only requests', () => {
    it('aborts pre-aborted and in-flight read operations cleanly', async () => {
      const preController = new AbortController();
      preController.abort('cancelled upfront');

      await expect(
        executeReadWithAbort(async () => 'never', { signal: preController.signal })
      ).rejects.toThrow(NetworkError);

      const liveController = new AbortController();
      const pending = executeReadWithAbort(
        () => new Promise((resolve) => setTimeout(() => resolve('ok'), 500)),
        { signal: liveController.signal, operationName: 'fetchAttestation' }
      );
      setTimeout(() => liveController.abort('user navigated away'), 20);
      await expect(pending).rejects.toThrow(/aborted/i);
    });
  });

  describe('#393 Structured log redaction', () => {
    it('redacts secret keys, tokens, and inline S... Stellar secrets recursively', () => {
      const sanitized = redactSensitiveFields({
        network: 'testnet',
        secret: VALID_SECRET,
        nested: {
          apiKey: 'abc-123',
          authorization: 'Bearer top-secret-jwt',
          note: `Signer ${VALID_SECRET} attempted sign`,
        },
      });

      expect(sanitized.network).toBe('testnet');
      expect(sanitized.secret).toBe(REDACTED_VALUE);
      expect(sanitized.nested.apiKey).toBe(REDACTED_VALUE);
      expect(sanitized.nested.authorization).toBe(REDACTED_VALUE);
      expect(sanitized.nested.note).not.toContain(VALID_SECRET);

      const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        const logger = createLogger('CoreTest', 'info');
        logger.info(`Secret leaked: ${VALID_SECRET}`, { privateKey: 'raw-key', ok: 1 });
        expect(spy.mock.calls[0][0]).not.toContain(VALID_SECRET);
        expect(spy.mock.calls[0][1]).toEqual({ privateKey: REDACTED_VALUE, ok: 1 });
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('#394 Stable simulation error codes', () => {
    it('maps distinct Soroban simulation failures to stable error codes', () => {
      expect(classifySimulationFailure('cpu budget exceeded').code).toBe(
        SOROBAN_SIMULATION_ERROR_CODES.RESOURCE_EXCEEDED
      );
      expect(classifySimulationFailure('unauthorized signature').code).toBe(
        SOROBAN_SIMULATION_ERROR_CODES.AUTH_INVALID
      );
      expect(classifySimulationFailure('ledger entry expired / archived').code).toBe(
        SOROBAN_SIMULATION_ERROR_CODES.FOOTPRINT_EXPIRED
      );
      expect(classifySimulationFailure('HostError: Error(Contract, #7)').contractErrorNumber).toBe(7);
    });
  });

  describe('#395 Contract address validation against selected network config', () => {
    it('rejects cross-network contract reuse and invalid formats', () => {
      const registry = {
        testnet: [VALID_CONTRACT_TESTNET],
        mainnet: [VALID_CONTRACT_MAINNET],
      };

      expect(
        validateContractAddressForNetwork(VALID_CONTRACT_TESTNET, { network: 'testnet' }, 'token', {
          networkRegistry: registry,
        })
      ).toBe(VALID_CONTRACT_TESTNET);

      expect(() =>
        validateContractAddressForNetwork(VALID_CONTRACT_TESTNET, { network: 'mainnet' }, 'token', {
          networkRegistry: registry,
        })
      ).toThrow(InvalidParametersError);

      expect(() =>
        validateContractAddressForNetwork('BAD_CONTRACT', { network: 'testnet' }, 'token')
      ).toThrow(InvalidParametersError);
    });
  });

  describe('#396 & #397 Capabilities query and runtime documentation', () => {
    it('returns typed SDK capabilities and runtime/network docs', () => {
      const caps = getSDKCapabilities({
        stellar: {
          network: 'testnet',
          serverUrl: STELLAR_NETWORKS.testnet.serverUrl,
          passphrase: STELLAR_NETWORKS.testnet.passphrase,
        },
        defaultTimeout: 20,
      });

      expect(caps.sdkName).toBe('stellar-asset-tokenization-suite');
      expect(caps.features.abortSignal).toBe(true);
      expect(caps.features.exactDecimal).toBe(true);
      expect(caps.features.structuredLogRedaction).toBe(true);
      expect(caps.selectedNetwork).toBe('testnet');
      expect(caps.defaultTimeoutMs).toBe(20_000);
      expect(SDK_RUNTIME_REQUIREMENTS.minNodeVersion).toBe('18.0.0');
      expect(SDK_NETWORK_DOCUMENTATION.mainnet.passphrase).toBe(
        STELLAR_NETWORKS.mainnet.passphrase
      );
    });
  });
});
