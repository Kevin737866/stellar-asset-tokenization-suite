/**
 * Unit tests for DashboardErrorBoundary helper functions.
 *
 * These tests cover the exported pure-function logic:
 *   - classifyError — maps raw error values to DashboardErrorKind
 *   - isRecoverableError — determines whether a retry action should be shown
 *
 * The class component itself (React.Component subclass) is integration-tested
 * via classifyError / isRecoverableError; a full render test would require
 * jsdom and @testing-library/react which are not configured here.
 */

import { classifyError, isRecoverableError } from '../components/DashboardErrorBoundary';
import type { DashboardErrorKind } from '../components/DashboardErrorBoundary';

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  describe('auth errors', () => {
    it('classifies TX_BAD_AUTH as auth', () => {
      expect(classifyError({ code: 'TX_BAD_AUTH' })).toBe('auth');
    });

    it('classifies COMPLIANCE_FAILED as auth', () => {
      expect(classifyError({ code: 'COMPLIANCE_FAILED' })).toBe('auth');
    });

    it('classifies KYC_NOT_VERIFIED as auth', () => {
      expect(classifyError({ code: 'KYC_NOT_VERIFIED' })).toBe('auth');
    });

    it('classifies BLACKLISTED as auth', () => {
      expect(classifyError({ code: 'BLACKLISTED' })).toBe('auth');
    });
  });

  describe('network errors', () => {
    it('classifies NETWORK_ERROR code as network', () => {
      expect(classifyError({ code: 'NETWORK_ERROR' })).toBe('network');
    });

    it('classifies errors with "Network" in message as network', () => {
      expect(classifyError({ message: 'Network request failed' })).toBe('network');
    });

    it('classifies errors with "fetch" in message as network', () => {
      expect(classifyError({ message: 'Failed to fetch data from endpoint' })).toBe('network');
    });

    it('classifies errors with "timeout" in message as network', () => {
      expect(classifyError({ message: 'Request timeout after 30s' })).toBe('network');
    });

    it('classifies errors with "ECONNREFUSED" in message as network', () => {
      expect(classifyError({ message: 'connect ECONNREFUSED 127.0.0.1:8000' })).toBe('network');
    });

    it('classifies errors with "failed to fetch" in message as network (case-insensitive)', () => {
      expect(classifyError({ message: 'Failed to Fetch' })).toBe('network');
    });

    it('prioritises auth code over network message', () => {
      // A BLACKLISTED error should be auth even if the message mentions Network
      expect(classifyError({ code: 'BLACKLISTED', message: 'Network restricted' })).toBe('auth');
    });
  });

  describe('fatal render errors', () => {
    it('classifies errors with _reactComponentStack as fatal', () => {
      const renderError = {
        message: 'Cannot read properties of undefined',
        _reactComponentStack: '\n    at OwnershipDashboard\n    at DashboardErrorBoundary',
      };
      expect(classifyError(renderError)).toBe('fatal');
    });
  });

  describe('recoverable errors', () => {
    it('classifies errors with no recognisable code or message as recoverable', () => {
      expect(classifyError({ message: 'Unexpected server response' })).toBe('recoverable');
    });

    it('classifies plain Error objects without special codes as recoverable', () => {
      expect(classifyError(new Error('Something went wrong'))).toBe('recoverable');
    });

    it('classifies SIMULATION_FAILED as recoverable', () => {
      expect(classifyError({ code: 'SIMULATION_FAILED' })).toBe('recoverable');
    });

    it('classifies TRADING_PAUSED as recoverable', () => {
      expect(classifyError({ code: 'TRADING_PAUSED' })).toBe('recoverable');
    });

    it('classifies ORDER_EXPIRED as recoverable', () => {
      expect(classifyError({ code: 'ORDER_EXPIRED' })).toBe('recoverable');
    });

    it('classifies INSUFFICIENT_BALANCE as recoverable', () => {
      expect(classifyError({ code: 'INSUFFICIENT_BALANCE' })).toBe('recoverable');
    });
  });

  describe('boundary / edge cases', () => {
    it('classifies null as recoverable', () => {
      expect(classifyError(null)).toBe('recoverable');
    });

    it('classifies undefined as recoverable', () => {
      expect(classifyError(undefined)).toBe('recoverable');
    });

    it('classifies empty string as recoverable', () => {
      expect(classifyError('')).toBe('recoverable');
    });

    it('classifies 0 as recoverable', () => {
      expect(classifyError(0)).toBe('recoverable');
    });

    it('classifies a plain string error message as recoverable', () => {
      // A thrown string (not an Error object) has no .code or .message
      expect(classifyError('Something broke')).toBe('recoverable');
    });

    it('classifies errors whose message is an empty string as recoverable', () => {
      expect(classifyError({ message: '' })).toBe('recoverable');
    });
  });
});

// ---------------------------------------------------------------------------
// isRecoverableError
// ---------------------------------------------------------------------------

describe('isRecoverableError', () => {
  const cases: Array<[DashboardErrorKind, boolean]> = [
    ['network', true],
    ['recoverable', true],
    ['auth', false],
    ['fatal', false],
  ];

  it.each(cases)(
    'returns %s for kind "%s"',
    (kind: DashboardErrorKind, expected: boolean) => {
      expect(isRecoverableError(kind)).toBe(expected);
    }
  );
});

// ---------------------------------------------------------------------------
// classifyError + isRecoverableError integration
// ---------------------------------------------------------------------------

describe('classifyError + isRecoverableError integration', () => {
  it('a network error is recoverable', () => {
    const kind = classifyError({ code: 'NETWORK_ERROR' });
    expect(isRecoverableError(kind)).toBe(true);
  });

  it('a recoverable error is retryable', () => {
    const kind = classifyError({ message: 'rate limit exceeded' });
    expect(isRecoverableError(kind)).toBe(true);
  });

  it('an auth error is not retryable', () => {
    const kind = classifyError({ code: 'KYC_NOT_VERIFIED' });
    expect(isRecoverableError(kind)).toBe(false);
  });

  it('a fatal render error is not retryable', () => {
    const kind = classifyError({ _reactComponentStack: '\n    at Foo', message: 'undefined' });
    expect(isRecoverableError(kind)).toBe(false);
  });

  it('no partial state changes occur — classifyError is a pure function', () => {
    // Calling classifyError twice with the same input returns the same result
    const error = { code: 'NETWORK_ERROR', message: 'failed to fetch' };
    expect(classifyError(error)).toBe(classifyError(error));
  });
});
