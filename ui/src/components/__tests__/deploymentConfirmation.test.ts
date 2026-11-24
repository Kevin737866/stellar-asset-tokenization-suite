import {
  buildDeploymentConfirmationSummary,
  canConfirmDeployment,
  formatAssetTypeLabel,
  formatSupplyDisplay,
} from '../deploymentConfirmation';

const VALID_INPUT = {
  name: '  Manhattan Office Tower  ',
  symbol: ' mot ',
  totalSupply: '1000000',
  decimals: 18,
  assetType: 'real_estate' as any,
  metadata: {
    location: ' New York ',
    valuation: '50000000',
  },
  complianceRegistry: ' GCOMPLIANCE1234567890 ',
  dividendDistributor: ' GDIVIDEND1234567890 ',
};

describe('buildDeploymentConfirmationSummary', () => {
  it('builds a normalized confirmation summary for valid deployment options', () => {
    const result = buildDeploymentConfirmationSummary(VALID_INPUT);

    expect(result.errors).toEqual({});
    expect(result.summary).not.toBeNull();
    expect(result.summary?.options).toEqual({
      name: 'Manhattan Office Tower',
      symbol: 'MOT',
      totalSupply: '1000000',
      decimals: 18,
      assetType: 'real_estate',
      metadata: {
        location: 'New York',
        valuation: '50000000',
      },
      complianceRegistry: 'GCOMPLIANCE1234567890',
      dividendDistributor: 'GDIVIDEND1234567890',
    });
    expect(result.summary?.assetTypeLabel).toBe('Real Estate');
    expect(result.summary?.formattedTotalSupply).toBe('1,000,000');
    expect(result.summary?.metadataEntries).toEqual([
      { key: 'location', value: 'New York' },
      { key: 'valuation', value: '50000000' },
    ]);
    expect(result.summary?.warnings.length).toBe(1);
    expect(result.summary?.warnings[0]).toContain('irreversible');
  });

  it('accepts boundary decimal values 0 and 18 and rejects out-of-range or non-integer decimals', () => {
    expect(
      buildDeploymentConfirmationSummary({ ...VALID_INPUT, decimals: 0 }).summary
    ).not.toBeNull();
    expect(
      buildDeploymentConfirmationSummary({ ...VALID_INPUT, decimals: 18 }).summary
    ).not.toBeNull();

    const negative = buildDeploymentConfirmationSummary({ ...VALID_INPUT, decimals: -1 });
    expect(negative.summary).toBeNull();
    expect(negative.errors.decimals).toBeDefined();

    const tooHigh = buildDeploymentConfirmationSummary({ ...VALID_INPUT, decimals: 19 });
    expect(tooHigh.summary).toBeNull();
    expect(tooHigh.errors.decimals).toBeDefined();

    const fractional = buildDeploymentConfirmationSummary({ ...VALID_INPUT, decimals: 6.5 });
    expect(fractional.summary).toBeNull();
    expect(fractional.errors.decimals).toBeDefined();
  });

  it('rejects invalid name, symbol, totalSupply, assetType, and contract addresses', () => {
    const result = buildDeploymentConfirmationSummary({
      name: 'AB',
      symbol: 'A!',
      totalSupply: '0',
      decimals: 18,
      assetType: '' as any,
      metadata: {},
      complianceRegistry: '   ',
      dividendDistributor: '',
    });

    expect(result.summary).toBeNull();
    expect(result.errors.name).toBeDefined();
    expect(result.errors.symbol).toBeDefined();
    expect(result.errors.totalSupply).toBeDefined();
    expect(result.errors.assetType).toBeDefined();
    expect(result.errors.complianceRegistry).toBeDefined();
    expect(result.errors.dividendDistributor).toBeDefined();
  });

  it('rejects non-finite and negative totalSupply values', () => {
    for (const invalidSupply of ['-100', 'NaN', 'Infinity', 'abc']) {
      const result = buildDeploymentConfirmationSummary({
        ...VALID_INPUT,
        totalSupply: invalidSupply,
      });
      expect(result.summary).toBeNull();
      expect(result.errors.totalSupply).toBeDefined();
    }
  });

  it('emits warnings when contract addresses match or metadata is empty', () => {
    const result = buildDeploymentConfirmationSummary({
      ...VALID_INPUT,
      metadata: { '   ': 'ignored' },
      complianceRegistry: 'GSAMEADDRESS',
      dividendDistributor: 'GSAMEADDRESS',
    });

    expect(result.summary).not.toBeNull();
    expect(result.summary?.metadataEntries).toEqual([]);
    expect(result.summary?.warnings.some((w) => w.includes('identical'))).toBe(true);
    expect(result.summary?.warnings.some((w) => w.includes('No asset metadata'))).toBe(true);
  });

  it('does not mutate caller input or metadata', () => {
    const input = {
      ...VALID_INPUT,
      metadata: { key: '  value  ' },
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    buildDeploymentConfirmationSummary(input);

    expect(input).toEqual(snapshot);
  });
});

describe('canConfirmDeployment', () => {
  const validSummary = buildDeploymentConfirmationSummary(VALID_INPUT).summary;

  it('allows deployment only when summary is present, acknowledged, wallet connected, and idle', () => {
    expect(
      canConfirmDeployment(validSummary, {
        acknowledged: true,
        isSubmitting: false,
        isLoading: false,
        walletConnected: true,
      })
    ).toEqual({ allowed: true });
  });

  it('blocks deployment when summary is missing', () => {
    const result = canConfirmDeployment(null, { acknowledged: true, walletConnected: true });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('blocks deployment when user has not explicitly acknowledged the summary', () => {
    const result = canConfirmDeployment(validSummary, {
      acknowledged: false,
      walletConnected: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('acknowledge');
  });

  it('blocks deployment when wallet is not connected / authorized', () => {
    const result = canConfirmDeployment(validSummary, {
      acknowledged: true,
      walletConnected: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('wallet');
  });

  it('blocks duplicate deployment while submitting or loading', () => {
    expect(
      canConfirmDeployment(validSummary, { acknowledged: true, isSubmitting: true }).allowed
    ).toBe(false);
    expect(
      canConfirmDeployment(validSummary, { acknowledged: true, isLoading: true }).allowed
    ).toBe(false);
  });
});

describe('formatting helpers', () => {
  it('formats asset type labels and supply display cleanly', () => {
    expect(formatAssetTypeLabel('intellectual_property' as any)).toBe('Intellectual Property');
    expect(formatSupplyDisplay('1234567.5')).toBe('1,234,567.5');
    expect(formatSupplyDisplay('not-a-number')).toBe('not-a-number');
  });
});
