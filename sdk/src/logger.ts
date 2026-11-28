// tsconfig lib is ES2020 without DOM, so the browser global needs a declaration.
declare const window: any;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

/** Default placeholder used when redacting secret-like values from logs. */
export const REDACTED_VALUE = '[REDACTED]';

/** Configuration options for structured log redaction. */
export interface RedactOptions {
  /** Additional case-insensitive field names to redact. */
  additionalKeys?: string[];
  /** Custom replacement string. Defaults to {@link REDACTED_VALUE}. */
  replacement?: string;
  /** Whether to also redact secret-like patterns inside string values. Defaults to `true`. */
  redactValues?: boolean;
}

/**
 * Normalized (lowercase, alphanumeric-only) exact field names that are always
 * treated as secrets.
 */
const EXACT_SECRET_KEYS = new Set<string>([
  'secret',
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'apikey',
  'apisecret',
  'privatekey',
  'privkey',
  'secretkey',
  'signingkey',
  'masterkey',
  'encryptionkey',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'bearertoken',
  'apitoken',
  'sessiontoken',
  'idtoken',
  'csrftoken',
  'authorization',
  'bearer',
  'cookie',
  'setcookie',
  'sessionid',
  'credential',
  'credentials',
  'mnemonic',
  'seed',
  'seedphrase',
  'jwt',
  'signature',
]);

/**
 * Patterns matched against normalized (lowercase, alphanumeric-only) key names.
 * Intentionally avoids matching benign domain keys like `tokenAddress`,
 * `tokenId`, `tokenSymbol`, `tokenName`, or `networkPassphrase`.
 */
const SECRET_KEY_PATTERNS: RegExp[] = [
  /secret/,
  /password/,
  /passwd/,
  /privatekey/,
  /privkey/,
  /apikey/,
  /signingkey/,
  /encryptionkey/,
  /mnemonic/,
  /seedphrase/,
  /credential/,
  /(access|refresh|auth|bearer|api|session|id|csrf)token/,
  /^(x)?auth/,
  /passphrase$/,
];

/**
 * Explicit allowlist of normalized non-secret domain keys that might otherwise
 * match a suffix rule (e.g. Stellar's public `networkPassphrase`).
 */
const NON_SECRET_KEYS = new Set<string>([
  'networkpassphrase',
]);

/** Patterns for secret-like string values (Stellar seeds, JWTs, Bearer tokens, PEM keys, URL credentials). */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  // Stellar StrKey secret seed (56 chars, starts with 'S', base32 alphabet A-Z2-7)
  /\bS[A-Z2-7]{55}\b/g,
  // Bearer authentication header value
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // JSON Web Token (header.payload.signature)
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // PEM-encoded private key blocks
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  // Credentials embedded in URLs: scheme://user:pass@host
  /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/g,
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Returns `true` if `key` matches a known secret-like field name or any
 * caller-supplied `additionalKeys`.
 */
export function isSecretKey(key: string, additionalKeys?: string[]): boolean {
  if (!key) return false;
  const normalized = normalizeKey(key);
  if (!normalized) return false;

  if (additionalKeys && additionalKeys.length > 0) {
    for (const extra of additionalKeys) {
      if (normalizeKey(extra) === normalized) {
        return true;
      }
    }
  }

  if (NON_SECRET_KEYS.has(normalized)) {
    return false;
  }

  if (EXACT_SECRET_KEYS.has(normalized)) {
    return true;
  }

  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Redact secret-like patterns (Stellar secret seeds, Bearer tokens, JWTs,
 * PEM private keys, and URL credentials) from a string value.
 */
export function redactStringValue(value: string, replacement: string = REDACTED_VALUE): string {
  let result = value;
  for (let i = 0; i < SECRET_VALUE_PATTERNS.length; i++) {
    const pattern = SECRET_VALUE_PATTERNS[i];
    pattern.lastIndex = 0;
    if (i === SECRET_VALUE_PATTERNS.length - 1) {
      // Preserve URL scheme and host while redacting user:pass
      result = result.replace(pattern, `$1${replacement}@`);
    } else if (i === 1) {
      // Preserve "Bearer " prefix while redacting token
      result = result.replace(pattern, `Bearer ${replacement}`);
    } else {
      result = result.replace(pattern, replacement);
    }
  }
  return result;
}

function redactInternal(
  value: unknown,
  options: Required<Pick<RedactOptions, 'replacement' | 'redactValues'>> & {
    additionalKeys?: string[];
  },
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return options.redactValues ? redactStringValue(value, options.replacement) : value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date || value instanceof RegExp) {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactInternal(item, options, seen));
  }

  if (value instanceof Error) {
    const sanitizedError: Record<string, unknown> = {
      name: value.name,
      message: options.redactValues
        ? redactStringValue(value.message, options.replacement)
        : value.message,
    };
    if (value.stack) {
      sanitizedError.stack = options.redactValues
        ? redactStringValue(value.stack, options.replacement)
        : value.stack;
    }
    for (const [k, v] of Object.entries(value)) {
      sanitizedError[k] = isSecretKey(k, options.additionalKeys)
        ? options.replacement
        : redactInternal(v, options, seen);
    }
    return sanitizedError;
  }

  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      const keyStr = String(k);
      out[keyStr] = isSecretKey(keyStr, options.additionalKeys)
        ? options.replacement
        : redactInternal(v, options, seen);
    }
    return out;
  }

  if (value instanceof Set) {
    return Array.from(value).map((item) => redactInternal(item, options, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(k, options.additionalKeys)) {
      out[k] = options.replacement;
    } else {
      out[k] = redactInternal(v, options, seen);
    }
  }
  return out;
}

/**
 * Recursively clone and redact secret-like fields and values from structured
 * log data without mutating the input.
 */
export function redactSecrets<T>(value: T, options: RedactOptions = {}): T {
  const resolved = {
    additionalKeys: options.additionalKeys,
    replacement: options.replacement ?? REDACTED_VALUE,
    redactValues: options.redactValues ?? true,
  };
  return redactInternal(value, resolved, new WeakSet<object>()) as T;
}

export class Logger {
  private component: string;
  private minLevel: LogLevel;
  private redactOptions: RedactOptions;

  constructor(
    component: string,
    minLevel: LogLevel = 'info',
    redactOptions: RedactOptions = {},
  ) {
    this.component = component;
    this.minLevel = minLevel;
    this.redactOptions = redactOptions;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;
    const replacement = this.redactOptions.replacement ?? REDACTED_VALUE;
    const redactValues = this.redactOptions.redactValues ?? true;
    const safeMessage = redactValues ? redactStringValue(message, replacement) : message;
    const safeData =
      data !== undefined ? redactSecrets(data, this.redactOptions) : undefined;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message: safeMessage,
      data: safeData,
    };
    const formatted = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.component}] ${entry.message}`;
    switch (level) {
      case 'error':
        console.error(formatted, safeData ?? '');
        break;
      case 'warn':
        console.warn(formatted, safeData ?? '');
        break;
      case 'debug':
        console.debug(formatted, safeData ?? '');
        break;
      default:
        console.log(formatted, safeData ?? '');
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }
}

export function createLogger(
  component: string,
  minLevel?: LogLevel,
  redactOptions?: RedactOptions,
): Logger {
  return new Logger(component, minLevel, redactOptions);
}

const globalObj = typeof globalThis !== 'undefined' ? (globalThis as Record<string, any>) : {};

export const isBrowser: boolean =
  typeof globalObj.window !== 'undefined' && typeof globalObj.window.document !== 'undefined';

export const isNode: boolean =
  typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
