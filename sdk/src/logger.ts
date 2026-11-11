export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_REGEX =
  /(secret|private[_-]?key|seed|mnemonic|password|passwd|api[_-]?key|token|authorization|auth[_-]?header|cookie|credential|signer[_-]?key)/i;

const STELLAR_SECRET_VALUE_REGEX = /\bS[A-Z2-7]{55}\b/g;
const BEARER_VALUE_REGEX = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function maskSensitiveString(value: string): string {
  return value
    .replace(STELLAR_SECRET_VALUE_REGEX, REDACTED_VALUE)
    .replace(BEARER_VALUE_REGEX, `Bearer ${REDACTED_VALUE}`);
}

/**
 * Recursively redacts secret-like fields and inline Stellar secret keys
 * or Bearer tokens from structured log payloads without mutating the caller's object.
 */
export function redactSensitiveFields<T>(
  input: T,
  seen: WeakSet<object> = new WeakSet()
): T {
  if (input == null) {
    return input;
  }
  if (typeof input === 'string') {
    return maskSensitiveString(input) as unknown as T;
  }
  if (typeof input !== 'object') {
    return input;
  }
  if (input instanceof Date || input instanceof RegExp) {
    return input;
  }
  if (input instanceof Error) {
    return {
      name: input.name,
      message: maskSensitiveString(input.message),
    } as unknown as T;
  }

  const objRef = input as unknown as object;
  if (seen.has(objRef)) {
    return '[Circular]' as unknown as T;
  }
  seen.add(objRef);

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveFields(item, seen)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      out[key] = REDACTED_VALUE;
    } else {
      out[key] = redactSensitiveFields(val, seen);
    }
  }
  return out as T;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private component: string;
  private minLevel: LogLevel;

  constructor(component: string, minLevel: LogLevel = 'info') {
    this.component = component;
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;
    const redactedMessage = maskSensitiveString(message);
    const redactedData = data !== undefined ? redactSensitiveFields(data) : undefined;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message: redactedMessage,
      data: redactedData
    };
    const formatted = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.component}] ${entry.message}`;
    switch (level) {
      case 'error':
        console.error(formatted, redactedData ?? '');
        break;
      case 'warn':
        console.warn(formatted, redactedData ?? '');
        break;
      case 'debug':
        console.debug(formatted, redactedData ?? '');
        break;
      default:
        console.log(formatted, redactedData ?? '');
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

export function createLogger(component: string, minLevel?: LogLevel): Logger {
  return new Logger(component, minLevel);
}

export const isBrowser: boolean =
  typeof window !== 'undefined' && typeof window.document !== 'undefined';

export const isNode: boolean =
  typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
