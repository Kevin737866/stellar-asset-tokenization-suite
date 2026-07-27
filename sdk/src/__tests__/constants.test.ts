/**
 * Unit tests for SDK constants.
 * Issue #220: SDK unit tests achieving 80%+ code coverage.
 */

import {
  DEFAULT_DECIMALS,
  DEFAULT_FEE_RATE,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_PAGINATION_LIMIT,
  DEFAULT_ORDER_EXPIRY_HOURS,
  DEFAULT_CUSTODY_EXPIRY_DAYS,
  DAY_IN_SECONDS,
  MONTH_IN_SECONDS,
  YEAR_IN_SECONDS,
  HOLDING_PERIOD_RULE_144,
  HOLDING_PERIOD_DEFAULT,
  HOLDING_PERIOD_INVOICE,
  TRANSFER_LIMIT_REAL_ESTATE,
  TRANSFER_LIMIT_COMMODITY,
  TRANSFER_LIMIT_INVOICE,
  TRANSFER_LIMIT_SECURITY,
  VALID_PURITY_GRADES,
  VALID_CREDIT_RATINGS,
  VALID_REGULATION_FRAMEWORKS,
  STELLAR_NETWORKS,
  RENTAL_YIELD_MAX_BASIS_POINTS,
  REPUTATION_SCORE_MAX,
  VINTAGE_YEAR_MIN
} from '../constants';

describe('Constants', () => {
  describe('Default values', () => {
    it('DEFAULT_DECIMALS is 18', () => {
      expect(DEFAULT_DECIMALS).toBe(18);
    });

    it('DEFAULT_FEE_RATE is 100', () => {
      expect(DEFAULT_FEE_RATE).toBe(100);
    });

    it('DEFAULT_TIMEOUT_SECONDS is 30', () => {
      expect(DEFAULT_TIMEOUT_SECONDS).toBe(30);
    });

    it('DEFAULT_PAGINATION_LIMIT is 50', () => {
      expect(DEFAULT_PAGINATION_LIMIT).toBe(50);
    });

    it('DEFAULT_ORDER_EXPIRY_HOURS is 24', () => {
      expect(DEFAULT_ORDER_EXPIRY_HOURS).toBe(24);
    });

    it('DEFAULT_CUSTODY_EXPIRY_DAYS is 30', () => {
      expect(DEFAULT_CUSTODY_EXPIRY_DAYS).toBe(30);
    });
  });

  describe('Time constants', () => {
    it('DAY_IN_SECONDS is 86400', () => {
      expect(DAY_IN_SECONDS).toBe(86400);
    });

    it('MONTH_IN_SECONDS is 2592000', () => {
      expect(MONTH_IN_SECONDS).toBe(2592000);
    });

    it('YEAR_IN_SECONDS is 31536000', () => {
      expect(YEAR_IN_SECONDS).toBe(31536000);
    });
  });

  describe('Holding periods', () => {
    it('HOLDING_PERIOD_RULE_144 is 365 days', () => {
      expect(HOLDING_PERIOD_RULE_144).toBe(365);
    });

    it('HOLDING_PERIOD_DEFAULT is 90 days', () => {
      expect(HOLDING_PERIOD_DEFAULT).toBe(90);
    });

    it('HOLDING_PERIOD_INVOICE is 30 days', () => {
      expect(HOLDING_PERIOD_INVOICE).toBe(30);
    });
  });

  describe('Transfer limits', () => {
    it('TRANSFER_LIMIT_REAL_ESTATE is 1M', () => {
      expect(TRANSFER_LIMIT_REAL_ESTATE).toBe(1000000n);
    });

    it('TRANSFER_LIMIT_COMMODITY is 5M', () => {
      expect(TRANSFER_LIMIT_COMMODITY).toBe(5000000n);
    });

    it('TRANSFER_LIMIT_INVOICE is 2.5M', () => {
      expect(TRANSFER_LIMIT_INVOICE).toBe(2500000n);
    });

    it('TRANSFER_LIMIT_SECURITY is 100K', () => {
      expect(TRANSFER_LIMIT_SECURITY).toBe(100000n);
    });
  });

  describe('Validation arrays', () => {
    it('VALID_PURITY_GRADES contains expected values', () => {
      expect(VALID_PURITY_GRADES).toContain('999');
      expect(VALID_PURITY_GRADES).toContain('995');
      expect(VALID_PURITY_GRADES).toContain('990');
      expect(VALID_PURITY_GRADES).toContain('750');
    });

    it('VALID_CREDIT_RATINGS contains expected values', () => {
      expect(VALID_CREDIT_RATINGS).toContain('AAA');
      expect(VALID_CREDIT_RATINGS).toContain('AA');
      expect(VALID_CREDIT_RATINGS).toContain('BBB');
      expect(VALID_CREDIT_RATINGS).toContain('CCC');
    });

    it('VALID_REGULATION_FRAMEWORKS contains expected values', () => {
      expect(VALID_REGULATION_FRAMEWORKS).toContain('REG_D');
      expect(VALID_REGULATION_FRAMEWORKS).toContain('REG_S');
      expect(VALID_REGULATION_FRAMEWORKS).toContain('RULE_144');
      expect(VALID_REGULATION_FRAMEWORKS).toContain('REG_A+');
    });

    it('RENTAL_YIELD_MAX_BASIS_POINTS is 10000', () => {
      expect(RENTAL_YIELD_MAX_BASIS_POINTS).toBe(10000);
    });

    it('REPUTATION_SCORE_MAX is 100', () => {
      expect(REPUTATION_SCORE_MAX).toBe(100);
    });

    it('VINTAGE_YEAR_MIN is 1990', () => {
      expect(VINTAGE_YEAR_MIN).toBe(1990);
    });
  });

  describe('STELLAR_NETWORKS', () => {
    it('has testnet configuration', () => {
      expect(STELLAR_NETWORKS.testnet).toBeDefined();
      expect(STELLAR_NETWORKS.testnet.serverUrl).toContain('testnet');
    });

    it('has mainnet configuration', () => {
      expect(STELLAR_NETWORKS.mainnet).toBeDefined();
      expect(STELLAR_NETWORKS.mainnet.serverUrl).toContain('stellar.org');
    });

    it('has futurenet configuration', () => {
      expect(STELLAR_NETWORKS.futurenet).toBeDefined();
      expect(STELLAR_NETWORKS.futurenet.serverUrl).toContain('futurenet');
    });

    it('has standalone configuration', () => {
      expect(STELLAR_NETWORKS.standalone).toBeDefined();
      expect(STELLAR_NETWORKS.standalone.serverUrl).toContain('localhost');
    });

    it('testnet uses Test passphrase', () => {
      expect(STELLAR_NETWORKS.testnet.passphrase).toContain('Test SDF');
    });

    it('mainnet uses Public passphrase', () => {
      expect(STELLAR_NETWORKS.mainnet.passphrase).toContain('Public Global');
    });
  });
});
