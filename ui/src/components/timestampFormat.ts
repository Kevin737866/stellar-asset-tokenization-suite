export type TimestampInput = Date | number | string | null | undefined;

export type TimestampVariant = 'datetime' | 'date' | 'time';

export type TimestampUnit = 'ms' | 's';

export interface FormatTimestampOptions {
  /**
   * Display preset:
   * - `'datetime'` (default): localized date and 24h/12h time (e.g. "Nov 24, 2026, 01:45 PM" in en-US)
   * - `'date'`: localized date only
   * - `'time'`: localized time with seconds
   */
  variant?: TimestampVariant;
  /**
   * Unit for numeric inputs: `'ms'` (milliseconds, default) or `'s'` (Unix seconds).
   */
  unit?: TimestampUnit;
  /**
   * Optional BCP 47 locale(s). Defaults to `undefined` so `Intl.DateTimeFormat`
   * uses the user's runtime/browser locale.
   */
  locale?: string | string[];
  /**
   * Optional IANA time zone identifier (e.g. `'UTC'`, `'America/New_York'`).
   * Defaults to the user's local time zone.
   */
  timeZone?: string;
  /**
   * String returned when the input is missing or cannot be parsed into a valid date.
   * Defaults to `'—'`.
   */
  fallback?: string;
}

const DEFAULT_FALLBACK = '—';

const VARIANT_OPTIONS: Record<TimestampVariant, Intl.DateTimeFormatOptions> = {
  datetime: {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
  date: {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  },
  time: {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  },
};

/**
 * Validates and converts a timestamp input into a valid `Date` instance,
 * or returns `null` if the input is empty, non-finite, or unparseable.
 */
export function toValidDate(
  input: TimestampInput,
  unit: TimestampUnit = 'ms'
): Date | null {
  if (input === null || input === undefined) {
    return null;
  }

  if (input instanceof Date) {
    return Number.isFinite(input.getTime()) ? input : null;
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      return null;
    }
    const ms = unit === 's' ? input * 1000 : input;
    if (!Number.isFinite(ms)) {
      return null;
    }
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }
    const date = new Date(trimmed);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  return null;
}

/**
 * Formats a timestamp in a consistent, user-localized format using `Intl.DateTimeFormat`.
 * Returns `fallback` (default `'—'`) for invalid or missing inputs without throwing.
 */
export function formatTimestamp(
  input: TimestampInput,
  options: FormatTimestampOptions = {}
): string {
  const {
    variant = 'datetime',
    unit = 'ms',
    locale,
    timeZone,
    fallback = DEFAULT_FALLBACK,
  } = options;

  const date = toValidDate(input, unit);
  if (!date) {
    return fallback;
  }

  const formatOptions: Intl.DateTimeFormatOptions = {
    ...VARIANT_OPTIONS[variant],
    ...(timeZone ? { timeZone } : {}),
  };

  try {
    return new Intl.DateTimeFormat(locale, formatOptions).format(date);
  } catch {
    // Gracefully recover if an invalid locale or timeZone was supplied
    try {
      return new Intl.DateTimeFormat(undefined, VARIANT_OPTIONS[variant]).format(date);
    } catch {
      return fallback;
    }
  }
}

/**
 * Convenience helper for formatting Unix epoch timestamps in seconds
 * (e.g. Soroban ledger timestamps) in a consistent, user-localized format.
 */
export function formatUnixTimestamp(
  seconds: number | null | undefined,
  options: Omit<FormatTimestampOptions, 'unit'> = {}
): string {
  return formatTimestamp(seconds, { ...options, unit: 's' });
}
