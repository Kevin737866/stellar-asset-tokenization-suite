import { describe, it, expect } from 'vitest';
import { MetricsCollector, PrometheusExporter, NoopExporter, ConsoleExporter } from '../telemetry';

describe('MetricsCollector', () => {
  it('does not record when disabled', () => {
    const collector = new MetricsCollector({ enabled: false });
    collector.recordCall('placeLimitOrder', 100, true);
    expect(collector.getSummary('placeLimitOrder').call_count).toBe(0);
  });

  it('records call_count and error_count correctly', () => {
    const collector = new MetricsCollector({ enabled: true, exporter: new NoopExporter() });
    collector.recordCall('claimDividend', 50, true);
    collector.recordCall('claimDividend', 80, false, 'INSUFFICIENT_BALANCE');
    const summary = collector.getSummary('claimDividend');
    expect(summary.call_count).toBe(2);
    expect(summary.error_count).toBe(1);
  });

  it('computes latency percentiles', () => {
    const collector = new MetricsCollector({ enabled: true, exporter: new NoopExporter() });
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].forEach(d => collector.recordCall('getOrderBook', d, true));
    const summary = collector.getSummary('getOrderBook');
    expect(summary.latency_p50).toBeGreaterThan(0);
    expect(summary.latency_p99).toBeGreaterThanOrEqual(summary.latency_p50);
  });
});

describe('Exporters', () => {
  it('ConsoleExporter implements the MetricsExporter interface', () => {
    const exporter = new ConsoleExporter();
    expect(typeof exporter.export).toBe('function');
  });

  it('NoopExporter implements the MetricsExporter interface without throwing', () => {
    const exporter = new NoopExporter();
    expect(() => exporter.export('test', { call_count: 1, error_count: 0, latency_p50: 1, latency_p95: 1, latency_p99: 1 })).not.toThrow();
  });

  it('PrometheusExporter produces valid Prometheus text format', () => {
    const exporter = new PrometheusExporter();
    exporter.export('placeLimitOrder', { call_count: 5, error_count: 1, latency_p50: 20, latency_p95: 45, latency_p99: 60 });
    const output = exporter.toPrometheusFormat();
    expect(output).toContain('sdk_call_count{method="placeLimitOrder"} 5');
    expect(output).toContain('sdk_error_count{method="placeLimitOrder"} 1');
  });
});
