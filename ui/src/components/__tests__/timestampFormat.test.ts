import {
  formatTimestamp,
  formatUnixTimestamp,
  toValidDate,
} from '../timestampFormat';

describe('timestampFormat', () => {
  const SAMPLE_ISO = '2026-03-15T14:30:45.000Z';
  const SAMPLE_DATE = new Date(SAMPLE_ISO);
  const SAMPLE_MS = SAMPLE_DATE.getTime();
  const SAMPLE_SEC = Math.floor(SAMPLE_MS / 1000);

  describe('toValidDate', () => {
    it('parses Date, millisecond epoch, Unix seconds, and ISO strings', () => {
      expect(toValidDate(SAMPLE_DATE)?.getTime()).toBe(SAMPLE_MS);
      expect(toValidDate(SAMPLE_MS)?.getTime()).toBe(SAMPLE_MS);
      expect(toValidDate(SAMPLE_SEC, 's')?.getTime()).toBe(SAMPLE_MS);
      expect(toValidDate(SAMPLE_ISO)?.getTime()).toBe(SAMPLE_MS);
    });

    it('handles boundary timestamps including epoch 0, leap day, and pre-1970', () => {
      expect(toValidDate(0)?.toISOString()).toBe('1970-01-01T00:00:00.000Z');
      expect(toValidDate(0, 's')?.toISOString()).toBe('1970-01-01T00:00:00.000Z');
      expect(toValidDate('2024-02-29T23:59:59.000Z')?.toISOString()).toBe(
        '2024-02-29T23:59:59.000Z'
      );
      expect(toValidDate(-86400, 's')?.toISOString()).toBe('1969-12-31T00:00:00.000Z');
    });

    it('returns null for invalid, empty, or non-finite inputs', () => {
      expect(toValidDate(null)).toBeNull();
      expect(toValidDate(undefined)).toBeNull();
      expect(toValidDate('')).toBeNull();
      expect(toValidDate('   ')).toBeNull();
      expect(toValidDate('not-a-timestamp')).toBeNull();
      expect(toValidDate(Number.NaN)).toBeNull();
      expect(toValidDate(Number.POSITIVE_INFINITY)).toBeNull();
      expect(toValidDate(Number.NEGATIVE_INFINITY)).toBeNull();
      expect(toValidDate(new Date('invalid'))).toBeNull();
    });
  });

  describe('formatTimestamp', () => {
    it('formats consistently for a given locale and time zone across input types', () => {
      const opts = { locale: 'en-US', timeZone: 'UTC' } as const;
      const fromDate = formatTimestamp(SAMPLE_DATE, opts);
      const fromMs = formatTimestamp(SAMPLE_MS, opts);
      const fromIso = formatTimestamp(SAMPLE_ISO, opts);
      const fromSec = formatUnixTimestamp(SAMPLE_SEC, opts);

      expect(fromDate).toBe(fromMs);
      expect(fromDate).toBe(fromIso);
      expect(fromDate).toBe(fromSec);
      expect(fromDate).toContain('2026');
      expect(fromDate).toContain('15');
    });

    it('adapts output to the requested user locale', () => {
      const enUs = formatTimestamp(SAMPLE_DATE, { locale: 'en-US', timeZone: 'UTC' });
      const deDe = formatTimestamp(SAMPLE_DATE, { locale: 'de-DE', timeZone: 'UTC' });
      expect(enUs).not.toBe(deDe);
      expect(deDe).toContain('2026');
    });

    it('uses the runtime default locale when locale is omitted', () => {
      const expected = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      }).format(SAMPLE_DATE);

      expect(formatTimestamp(SAMPLE_DATE, { timeZone: 'UTC' })).toBe(expected);
    });

    it('supports datetime, date, and time variants', () => {
      const dateOnly = formatTimestamp(SAMPLE_DATE, {
        variant: 'date',
        locale: 'en-US',
        timeZone: 'UTC',
      });
      const timeOnly = formatTimestamp(SAMPLE_DATE, {
        variant: 'time',
        locale: 'en-US',
        timeZone: 'UTC',
      });

      expect(dateOnly).toBe('Mar 15, 2026');
      expect(timeOnly).toContain('30:45');
    });

    it('returns fallback without throwing on invalid inputs', () => {
      expect(formatTimestamp(null)).toBe('—');
      expect(formatTimestamp(undefined)).toBe('—');
      expect(formatTimestamp('')).toBe('—');
      expect(formatTimestamp('invalid-date')).toBe('—');
      expect(formatTimestamp(Number.NaN)).toBe('—');
      expect(formatUnixTimestamp(undefined)).toBe('—');
      expect(formatTimestamp(null, { fallback: 'N/A' })).toBe('N/A');
    });

    it('recovers gracefully when an invalid locale or timeZone is passed', () => {
      const result = formatTimestamp(SAMPLE_DATE, {
        locale: 'not_a_valid_locale_tag!!!',
        timeZone: 'Mars/Olympus_Mons',
      });
      expect(result).not.toBe('—');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
