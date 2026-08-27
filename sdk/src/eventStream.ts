// WebSocket subscription support for real-time event streaming (Issue #190)
//
// The EventStream class opens a single WebSocket connection to an event relay
// and multiplexes typed subscriptions over it. It handles:
//   - typed subscribe(eventType, callback) with per-subscription filtering
//   - auto-reconnect with exponential backoff (+ jitter)
//   - heartbeat / ping for stale-connection detection
//   - server-side subscription (re)registration on (re)connect
//
// The WebSocket implementation is injectable so it can be unit-tested against a
// mock server without a real network. In Node it falls back to the global
// `WebSocket` (Node 21+) and in the browser to `window.WebSocket`.

import { createLogger, Logger } from './logger';
import { InvalidParametersError } from './errors';
import type {
  StreamEventType,
  StreamEvent,
  EventFilter,
  EventStreamConfig,
  EventStreamState,
  EventStreamStatus,
  EventStreamLifecycleEvent,
  MinimalWebSocket,
  WebSocketConstructor,
} from './types';

export const STREAM_EVENT_TYPES: StreamEventType[] = [
  'Transfer',
  'Trade',
  'DividendClaim',
  'KYCUpdate',
  'CustodyAttestation',
];

const DEFAULT_CONFIG: Required<Omit<EventStreamConfig, 'url' | 'webSocketImpl' | 'protocols'>> = {
  autoReconnect: true,
  maxReconnectAttempts: Infinity,
  baseReconnectDelayMs: 1_000,
  maxReconnectDelayMs: 30_000,
  backoffMultiplier: 2,
  reconnectJitter: 0.25,
  heartbeatIntervalMs: 15_000,
  heartbeatTimeoutMs: 10_000,
  connectTimeoutMs: 10_000,
};

// WebSocket.readyState values (spec constants, redeclared to avoid a DOM lib dep).
const WS_OPEN = 1;

interface Subscription {
  id: number;
  eventType: StreamEventType;
  callback: (event: StreamEvent) => void;
  filter?: EventFilter;
}

type Listener = (payload: EventStreamLifecycleEvent) => void;

function resolveWebSocketImpl(explicit?: WebSocketConstructor): WebSocketConstructor {
  if (explicit) return explicit;
  const g: any = globalThis as any;
  if (typeof g.WebSocket === 'function') return g.WebSocket as WebSocketConstructor;
  throw new InvalidParametersError(
    'No WebSocket implementation available. Pass config.webSocketImpl (e.g. the "ws" package) ' +
      'or run on a platform with a global WebSocket.'
  );
}

function matchesAddressFilter(filterValue: string | string[] | undefined, actual: string | undefined): boolean {
  if (filterValue === undefined) return true;
  if (actual === undefined) return false;
  const wanted = Array.isArray(filterValue) ? filterValue : [filterValue];
  const actualLc = actual.toLowerCase();
  return wanted.some((w) => w.toLowerCase() === actualLc);
}

/**
 * Returns true when `event` passes `filter` (token_address / user_address).
 * Exported for testing the filter logic in isolation.
 */
export function eventMatchesFilter(event: StreamEvent, filter?: EventFilter): boolean {
  if (!filter) return true;
  return (
    matchesAddressFilter(filter.tokenAddress, event.tokenAddress) &&
    matchesAddressFilter(filter.userAddress, event.userAddress)
  );
}

export class EventStream {
  private readonly url: string;
  private readonly protocols?: string | string[];
  private readonly WebSocketImpl: WebSocketConstructor;
  private readonly config: Required<Omit<EventStreamConfig, 'url' | 'webSocketImpl' | 'protocols'>>;
  private readonly logger: Logger;

  private ws: MinimalWebSocket | null = null;
  private status: EventStreamStatus = 'idle';
  private subscriptions = new Map<number, Subscription>();
  private listeners = new Map<string, Set<Listener>>();
  private nextSubscriptionId = 1;

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMessageAt = 0;
  private manuallyClosed = false;

  constructor(config: EventStreamConfig) {
    if (!config || !config.url) {
      throw new InvalidParametersError('EventStream requires a config.url');
    }
    this.url = config.url;
    this.protocols = config.protocols;
    this.WebSocketImpl = resolveWebSocketImpl(config.webSocketImpl);
    this.config = { ...DEFAULT_CONFIG, ...stripUndefined(config) };
    this.logger = createLogger('EventStream');
  }

  /** Current connection status. */
  getStatus(): EventStreamStatus {
    return this.status;
  }

  getState(): EventStreamState {
    return {
      status: this.status,
      url: this.url,
      reconnectAttempts: this.reconnectAttempts,
      subscriptionCount: this.subscriptions.size,
      lastMessageAt: this.lastMessageAt || undefined,
    };
  }

  /**
   * Subscribe to a stream event type. Returns an unsubscribe function.
   *
   * @param eventType One of Transfer | Trade | DividendClaim | KYCUpdate | CustodyAttestation
   * @param callback  Invoked for every matching event
   * @param filter    Optional token_address / user_address filter
   */
  subscribe(
    eventType: StreamEventType,
    callback: (event: StreamEvent) => void,
    filter?: EventFilter
  ): () => void {
    if (!STREAM_EVENT_TYPES.includes(eventType)) {
      throw new InvalidParametersError(
        `Unknown event type "${eventType}". Expected one of: ${STREAM_EVENT_TYPES.join(', ')}`
      );
    }
    if (typeof callback !== 'function') {
      throw new InvalidParametersError('subscribe(eventType, callback): callback must be a function');
    }

    const id = this.nextSubscriptionId++;
    const sub: Subscription = { id, eventType, callback, filter };
    this.subscriptions.set(id, sub);

    if (this.isOpen()) {
      this.sendSubscribeFrame(sub);
    } else if (this.status === 'idle') {
      // Lazily connect on first subscription.
      this.connect();
    }

    return () => this.unsubscribe(id);
  }

  private unsubscribe(id: number): void {
    const sub = this.subscriptions.get(id);
    if (!sub) return;
    this.subscriptions.delete(id);
    if (this.isOpen()) {
      // Only drop the server-side subscription when no other local subscription
      // still needs this event type.
      const stillNeeded = [...this.subscriptions.values()].some((s) => s.eventType === sub.eventType);
      if (!stillNeeded) {
        this.safeSend({ action: 'unsubscribe', event: sub.eventType });
      }
    }
  }

  /** Register a lifecycle listener: 'open' | 'close' | 'error' | 'reconnecting' | 'stale'. */
  on(event: EventStreamLifecycleEvent['type'], listener: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  /** Open the WebSocket connection. Safe to call multiple times. */
  connect(): void {
    if (this.status === 'connecting' || this.status === 'open') return;
    this.manuallyClosed = false;
    this.openSocket();
  }

  /** Close the connection and stop reconnecting. */
  close(code = 1000, reason = 'client closed'): void {
    this.manuallyClosed = true;
    this.clearTimers();
    this.setStatus('closed');
    if (this.ws) {
      try {
        this.ws.close(code, reason);
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  // --- internals -------------------------------------------------------------

  private openSocket(): void {
    this.setStatus('connecting');
    let ws: MinimalWebSocket;
    try {
      ws = this.protocols
        ? new this.WebSocketImpl(this.url, this.protocols as any)
        : new this.WebSocketImpl(this.url);
    } catch (err) {
      this.logger.error('WebSocket construction failed', { error: (err as Error).message });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    this.connectTimeoutTimer = setTimeout(() => {
      if (this.status === 'connecting') {
        this.logger.warn('Connection attempt timed out');
        this.forceReconnect('connect-timeout');
      }
    }, this.config.connectTimeoutMs);

    ws.onopen = () => {
      this.clearTimer('connectTimeoutTimer');
      this.reconnectAttempts = 0;
      this.lastMessageAt = now();
      this.setStatus('open');
      this.logger.info('WebSocket connected', { url: this.url });
      // Re-register every active subscription.
      for (const sub of this.subscriptions.values()) this.sendSubscribeFrame(sub);
      this.startHeartbeat();
      this.emit({ type: 'open' });
    };

    ws.onmessage = (ev: { data: any }) => {
      this.lastMessageAt = now();
      this.resetStaleTimer();
      this.handleRawMessage(ev.data);
    };

    ws.onerror = (ev: any) => {
      const message = ev?.message || ev?.error?.message || 'websocket error';
      this.logger.warn('WebSocket error', { message });
      this.emit({ type: 'error', error: new Error(message) });
    };

    ws.onclose = (ev: any) => {
      this.clearTimer('connectTimeoutTimer');
      this.stopHeartbeat();
      this.ws = null;
      this.logger.info('WebSocket closed', { code: ev?.code, reason: ev?.reason });
      this.emit({ type: 'close', code: ev?.code, reason: ev?.reason });
      if (!this.manuallyClosed) this.scheduleReconnect();
      else this.setStatus('closed');
    };
  }

  private handleRawMessage(data: any): void {
    let parsed: any;
    try {
      parsed = typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString());
    } catch {
      this.logger.warn('Received non-JSON message; ignoring');
      return;
    }

    // Heartbeat handling.
    if (parsed.type === 'pong' || parsed.type === 'ping') {
      if (parsed.type === 'ping') this.safeSend({ type: 'pong', ts: now() });
      return;
    }

    const type: StreamEventType | undefined = parsed.type || parsed.event;
    if (!type || !STREAM_EVENT_TYPES.includes(type)) return;

    const event: StreamEvent = normalizeEvent(type, parsed);
    for (const sub of this.subscriptions.values()) {
      if (sub.eventType !== type) continue;
      if (!eventMatchesFilter(event, sub.filter)) continue;
      try {
        sub.callback(event);
      } catch (err) {
        this.logger.error('Subscription callback threw', { error: (err as Error).message });
      }
    }
  }

  private sendSubscribeFrame(sub: Subscription): void {
    this.safeSend({
      action: 'subscribe',
      event: sub.eventType,
      filters: sub.filter
        ? { token_address: sub.filter.tokenAddress, user_address: sub.filter.userAddress }
        : undefined,
    });
  }

  private safeSend(payload: unknown): void {
    if (!this.isOpen()) return;
    try {
      this.ws!.send(JSON.stringify(payload));
    } catch (err) {
      this.logger.warn('Failed to send frame', { error: (err as Error).message });
    }
  }

  private isOpen(): boolean {
    return !!this.ws && this.ws.readyState === WS_OPEN && this.status === 'open';
  }

  // --- heartbeat ------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.config.heartbeatIntervalMs <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      this.safeSend({ type: 'ping', ts: now() });
    }, this.config.heartbeatIntervalMs);
    this.resetStaleTimer();
  }

  private stopHeartbeat(): void {
    this.clearTimer('heartbeatTimer');
    this.clearTimer('staleTimer');
  }

  private resetStaleTimer(): void {
    if (this.config.heartbeatTimeoutMs <= 0 || this.config.heartbeatIntervalMs <= 0) return;
    this.clearTimer('staleTimer');
    this.staleTimer = setTimeout(() => {
      this.logger.warn('No traffic within heartbeat window; treating connection as stale');
      this.emit({ type: 'stale' });
      this.forceReconnect('stale');
    }, this.config.heartbeatIntervalMs + this.config.heartbeatTimeoutMs);
  }

  // --- reconnect -----------------------------------------------------------

  private forceReconnect(reason: string): void {
    if (this.ws) {
      try {
        this.ws.close(4000, reason);
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.stopHeartbeat();
    if (!this.manuallyClosed) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.config.autoReconnect || this.manuallyClosed) {
      this.setStatus('closed');
      return;
    }
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.logger.error('Max reconnect attempts reached; giving up', {
        attempts: this.reconnectAttempts,
      });
      this.setStatus('closed');
      this.emit({ type: 'error', error: new Error('max reconnect attempts reached') });
      return;
    }

    const delay = this.computeBackoffDelay(this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.setStatus('reconnecting');
    this.emit({ type: 'reconnecting', attempt: this.reconnectAttempts, delayMs: delay });
    this.logger.info('Scheduling reconnect', { attempt: this.reconnectAttempts, delayMs: delay });

    this.clearTimer('reconnectTimer');
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  /** Exponential backoff with optional jitter. Exported behavior tested directly. */
  computeBackoffDelay(attempt: number): number {
    const { baseReconnectDelayMs, maxReconnectDelayMs, backoffMultiplier, reconnectJitter } = this.config;
    const raw = baseReconnectDelayMs * Math.pow(backoffMultiplier, attempt);
    const capped = Math.min(raw, maxReconnectDelayMs);
    if (!reconnectJitter) return capped;
    const jitterRange = capped * reconnectJitter;
    const offset = (deterministicJitter(attempt) * 2 - 1) * jitterRange;
    return Math.max(0, Math.round(capped + offset));
  }

  // --- helpers -----------------------------------------------------------

  private setStatus(status: EventStreamStatus): void {
    this.status = status;
  }

  private emit(payload: EventStreamLifecycleEvent): void {
    const set = this.listeners.get(payload.type);
    if (!set) return;
    for (const l of set) {
      try {
        l(payload);
      } catch (err) {
        this.logger.error('Lifecycle listener threw', { error: (err as Error).message });
      }
    }
  }

  private clearTimers(): void {
    this.clearTimer('reconnectTimer');
    this.clearTimer('heartbeatTimer');
    this.clearTimer('staleTimer');
    this.clearTimer('connectTimeoutTimer');
  }

  private clearTimer(
    name: 'reconnectTimer' | 'heartbeatTimer' | 'staleTimer' | 'connectTimeoutTimer'
  ): void {
    const t = this[name];
    if (t) {
      clearTimeout(t as any);
      clearInterval(t as any);
      this[name] = null;
    }
  }
}

function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as any)[k] = v;
  }
  return out;
}

function now(): number {
  return Date.now();
}

// A cheap, dependency-free pseudo-jitter derived from the attempt number so
// backoff timing stays deterministic for tests while still spreading retries.
function deterministicJitter(seed: number): number {
  const x = Math.sin((seed + 1) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function normalizeEvent(type: StreamEventType, raw: any): StreamEvent {
  const data = raw.data ?? raw.payload ?? {};
  return {
    type,
    tokenAddress:
      raw.token_address ?? raw.tokenAddress ?? data.token_address ?? data.tokenAddress ?? undefined,
    userAddress:
      raw.user_address ??
      raw.userAddress ??
      data.user_address ??
      data.userAddress ??
      data.from ??
      data.to ??
      undefined,
    data,
    timestamp: raw.timestamp ?? raw.ts ?? now(),
    txHash: raw.tx_hash ?? raw.txHash ?? data.tx_hash ?? data.txHash ?? undefined,
    ledger: raw.ledger ?? data.ledger ?? undefined,
  };
}
