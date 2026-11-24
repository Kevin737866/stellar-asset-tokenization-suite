import { STELLAR_NETWORKS } from '../constants';
import { InvalidParametersError } from '../errors';
import type { RWASDKConfig } from '../types';
import {
  validateContractId,
  validateNetworkConfig,
  validateNetworkContractAddresses,
  validateNetworkPassphrase,
  validateStellarNetwork,
} from '../validation';

const CONTRACT_ID = 'CA3D5K2AZ5HUVLWWPQJ6TAGQFQ2SBWZWOWLHGW4UMDBFTRHTO6MCGZTL';
const ACCOUNT_ID = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

function validConfig(overrides: Partial<RWASDKConfig> = {}): RWASDKConfig {
  return {
    stellar: {
      network: 'testnet',
      serverUrl: STELLAR_NETWORKS.testnet.serverUrl,
      passphrase: STELLAR_NETWORKS.testnet.passphrase,
    },
    contracts: {
      assetFactory: CONTRACT_ID as unknown as RWASDKConfig['contracts']['assetFactory'],
      complianceRegistry: CONTRACT_ID as unknown as RWASDKConfig['contracts']['complianceRegistry'],
      dividendDistributor: CONTRACT_ID as unknown as RWASDKConfig['contracts']['dividendDistributor'],
      secondaryMarket: CONTRACT_ID as unknown as RWASDKConfig['contracts']['secondaryMarket'],
      custodyValidator: CONTRACT_ID as unknown as RWASDKConfig['contracts']['custodyValidator'],
    },
    ...overrides,
  };
}

describe('network contract address validation', () => {
  describe('validateContractId', () => {
    it('accepts C-prefixed contract IDs and Address-like objects', () => {
      expect(() => validateContractId(CONTRACT_ID, 'contract')).not.toThrow();
      expect(() => validateContractId({ toString: () => CONTRACT_ID }, 'contract')).not.toThrow();
    });

    it('rejects G-prefixed account IDs used as contract addresses', () => {
      expect(() => validateContractId(ACCOUNT_ID, 'config.contracts.assetFactory')).toThrow(
        new InvalidParametersError(
          'Invalid config.contracts.assetFactory: must be a valid Stellar contract ID (C...)',
        ),
      );
    });

    it('rejects malformed and missing IDs', () => {
      expect(() => validateContractId('not-an-id', 'contract')).toThrow(InvalidParametersError);
      expect(() => validateContractId(undefined, 'contract')).toThrow('contract is required');
    });
  });

  describe('validateStellarNetwork', () => {
    it('accepts configured networks', () => {
      for (const network of Object.keys(STELLAR_NETWORKS)) {
        expect(() => validateStellarNetwork(network)).not.toThrow();
      }
    });

    it('rejects unknown networks', () => {
      expect(() => validateStellarNetwork('devnet')).toThrow(
        /must be one of testnet, mainnet, futurenet, standalone/,
      );
    });
  });

  describe('validateNetworkPassphrase', () => {
    it('requires the passphrase to match the selected network', () => {
      expect(() => validateNetworkPassphrase('testnet', STELLAR_NETWORKS.testnet.passphrase)).not.toThrow();
      expect(() => validateNetworkPassphrase('testnet', STELLAR_NETWORKS.mainnet.passphrase)).toThrow(
        'Invalid config.stellar.passphrase: must match the testnet network passphrase',
      );
    });
  });

  describe('validateNetworkContractAddresses', () => {
    it('rejects an account ID in any contract field with the field name', () => {
      for (const field of ['assetFactory', 'complianceRegistry', 'dividendDistributor', 'secondaryMarket', 'custodyValidator'] as const) {
        const contracts = validConfig().contracts;
        (contracts as unknown as Record<string, unknown>)[field] = ACCOUNT_ID;
        expect(() => validateNetworkContractAddresses(contracts)).toThrow(
          `Invalid config.contracts.${field}: must be a valid Stellar contract ID (C...)`,
        );
      }
    });

    it('rejects missing contract entries', () => {
      const contracts = validConfig().contracts as unknown as Record<string, unknown>;
      delete contracts.assetFactory;
      expect(() => validateNetworkContractAddresses(contracts)).toThrow(
        'config.contracts.assetFactory is required',
      );
    });
  });

  describe('validateNetworkConfig', () => {
    it('accepts a consistent network configuration', () => {
      expect(() => validateNetworkConfig(validConfig())).not.toThrow();
    });

    it('rejects a passphrase from a different network', () => {
      const config = validConfig();
      config.stellar.passphrase = STELLAR_NETWORKS.mainnet.passphrase;
      expect(() => validateNetworkConfig(config)).toThrow(
        'Invalid config.stellar.passphrase: must match the testnet network passphrase',
      );
    });

    it('rejects an unsupported network before checking contracts', () => {
      const config = validConfig();
      (config.stellar as unknown as { network: string }).network = 'devnet';
      expect(() => validateNetworkConfig(config)).toThrow(/must be one of/);
    });

    it('rejects invalid contract addresses for the selected network', () => {
      const config = validConfig();
      (config.contracts as unknown as Record<string, unknown>).secondaryMarket = ACCOUNT_ID;
      expect(() => validateNetworkConfig(config)).toThrow(
        'Invalid config.contracts.secondaryMarket: must be a valid Stellar contract ID (C...)',
      );
    });
  });
});
