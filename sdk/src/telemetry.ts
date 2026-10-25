export interface CallMetric {
  method: string;
  duration: number;
  success: boolean;
  errorCode?: string;
  timestamp: number;
}

export interface MetricsSummary {
  call_count: number;
  error_count: number;
  latency_p50: number;
  latency_p95: number;
  latency_p99: number;
}

export interface MetricsExporter {
  export(method: string, summary: MetricsSummary): void;
}

export class ConsoleExporter implements MetricsExporter {
  export(method: string, summary: MetricsSummary): void {
    console.log(`[metrics] ${method}`, summary);
  }
}

export class NoopExporter implements MetricsExporter {
  export(_method: string, _summary: MetricsSummary): void {
    // intentionally no-op
  }
}

export class PrometheusExporter implements MetricsExporter {
  private lines: string[] = [];

  export(method: string, summary: MetricsSummary): void {
    const labels = `{method="${method}"}`;
    this.lines.push(
      `sdk_call_count${labels} ${summary.call_count}`,
      `sdk_error_count${labels} ${summary.error_count}`,
      `sdk_latency_p50${labels} ${summary.latency_p50}`,
      `sdk_latency_p95${labels} ${summary.latency_p95}`,
      `sdk_latency_p99${labels} ${summary.latency_p99}`
    );
  }

  toPrometheusFormat(): string {
    return this.lines.join('\n');
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export class MetricsCollector {
  private enabled: boolean;
  private exporter: MetricsExporter;
  private calls: Map<string, CallMetric[]> = new Map();

  constructor(options: { enabled?: boolean; exporter?: MetricsExporter } = {}) {
    this.enabled = options.enabled ?? false;
    this.exporter = options.exporter ?? new NoopExporter();
  }

  recordCall(method: string, duration: number, success: boolean, errorCode?: string): void {
    if (!this.enabled) return;
    const metric: CallMetric = { method, duration, success, errorCode, timestamp: Date.now() };
    const existing = this.calls.get(method) ?? [];
    existing.push(metric);
    this.calls.set(method, existing);
    this.exporter.export(method, this.getSummary(method));
  }

  getSummary(method: string): MetricsSummary {
    const metrics = this.calls.get(method) ?? [];
    const durations = metrics.map(m => m.duration).sort((a, b) => a - b);
    return {
      call_count: metrics.length,
      error_count: metrics.filter(m => !m.success).length,
      latency_p50: percentile(durations, 50),
      latency_p95: percentile(durations, 95),
      latency_p99: percentile(durations, 99)
    };
  }

  getAllSummaries(): Record<string, MetricsSummary> {
    const result: Record<string, MetricsSummary> = {};
    for (const method of this.calls.keys()) {
      result[method] = this.getSummary(method);
    }
    return result;
  }
}

export function createMetricsCollector(config: {
  telemetry?: { enabled?: boolean; exporter?: 'console' | 'prometheus' | 'noop' };
}): MetricsCollector {
  const enabled = config.telemetry?.enabled ?? false;
  const exporterName = config.telemetry?.exporter ?? 'noop';
  const exporter: MetricsExporter =
    exporterName === 'console' ? new ConsoleExporter() :
    exporterName === 'prometheus' ? new PrometheusExporter() :
    new NoopExporter();
  return new MetricsCollector({ enabled, exporter });
}
