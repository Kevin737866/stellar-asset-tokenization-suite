export const DEFAULT_DECIMALS = 18;

export const DEFAULT_FEE_RATE = 100;
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const DEFAULT_PAGINATION_LIMIT = 50;
export const DEFAULT_PRICE_HISTORY_LIMIT = 100;
export const DEFAULT_MARKET_DEPTH = 10;
export const DEFAULT_ORDER_EXPIRY_HOURS = 24;
export const DEFAULT_CUSTODY_EXPIRY_DAYS = 30;
export const DAY_IN_SECONDS = 86400;
export const MONTH_IN_SECONDS = 2592000;
export const YEAR_IN_SECONDS = 31536000;
export const YEAR_IN_MILLISECONDS = 365 * 24 * 60 * 60 * 1000;
export const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
export const MONTH_IN_MILLISECONDS = 30 * DAY_IN_MILLISECONDS;
export const MILLISECONDS_PER_MINUTE = 60 * 1000;
export const REPUTATION_SCORE_LOW_THRESHOLD = 30;
export const REPUTATION_SCORE_MINIMUM = 30;
export const REPUTATION_SCORE_MAX = 100;

export const HOLDING_PERIOD_RULE_144 = 365;
export const HOLDING_PERIOD_DEFAULT = 90;
export const HOLDING_PERIOD_INVOICE = 30;
export const HOLDING_PERIOD_ART = 180;
export const HOLDING_PERIOD_SECURITY = 365;

export const TRANSFER_LIMIT_REAL_ESTATE = BigInt(1000000);
export const TRANSFER_LIMIT_COMMODITY = BigInt(5000000);
export const TRANSFER_LIMIT_INVOICE = BigInt(2500000);
export const TRANSFER_LIMIT_SECURITY = BigInt(100000);
export const TRANSFER_LIMIT_ART = BigInt(500000);
export const TRANSFER_LIMIT_CARBON_CREDIT = BigInt(10000000);

export const DEFAULT_DAILY_LIMIT = 10000;
export const DEFAULT_MONTHLY_LIMIT = 100000;
export const DEFAULT_ANNUAL_LIMIT = 1000000;

export const RENTAL_YIELD_MIN_BASIS_POINTS = 0;
export const RENTAL_YIELD_MAX_BASIS_POINTS = 10000;

export const VALID_PURITY_GRADES = ['999', '995', '990', '750'] as const;
export const VALID_CREDIT_RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC'] as const;
export const VALID_REGULATION_FRAMEWORKS = ['REG_D', 'REG_S', 'RULE_144', 'REG_A+'] as const;
export const VALID_CARBON_STANDARDS = ['VCS', 'GS', 'CDM', 'ACR'] as const;
export const VINTAGE_YEAR_MIN = 1990;

export const STELLAR_NETWORKS: Record<string, { serverUrl: string; horizonUrl: string; passphrase: string }> = {
  testnet: {
    serverUrl: 'https://horizon-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    passphrase: 'Test SDF Network ; September 2015'
  },
  mainnet: {
    serverUrl: 'https://horizon.stellar.org',
    horizonUrl: 'https://horizon.stellar.org',
    passphrase: 'Public Global Stellar Network ; September 2015'
  },
  futurenet: {
    serverUrl: 'https://horizon-futurenet.stellar.org',
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    passphrase: 'Test SDF Future Network ; October 2022'
  },
  standalone: {
    serverUrl: 'http://localhost:8000',
    horizonUrl: 'http://localhost:8000',
    passphrase: 'Standalone Network ; February 2017'
  }
};

export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const SALT_WORD_COUNT = 12;
export const DEFAULT_SALT_STRENGTH = 128;
