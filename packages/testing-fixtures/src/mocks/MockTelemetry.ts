/**
 * Mock Telemetry for Testing
 *
 * Records all telemetry calls for assertions.
 * Compatible with @sidekick/core Telemetry interface.
 *
 * @example
 * ```typescript
 * const telemetry = new MockTelemetry();
 * telemetry.histogram('duration', 100, 'ms', { op: 'test' });
 * expect(telemetry.histograms).toHaveLength(1);
 * expect(telemetry.histograms[0].name).toBe('duration');
 * ```
 */

import type { Telemetry } from '@sidekick/types'

export interface CounterRecord {
  name: string
  tags?: Record<string, string>
}

export interface GaugeRecord {
  name: string
  value: number
  tags?: Record<string, string>
}

export interface HistogramRecord {
  name: string
  value: number
  unit: string
  tags?: Record<string, string>
}

export class MockTelemetry implements Telemetry {
  public counters: CounterRecord[] = []
  public gauges: GaugeRecord[] = []
  public histograms: HistogramRecord[] = []

  increment(name: string, tags?: Record<string, string>): void {
    this.counters.push({ name, tags })
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    this.gauges.push({ name, value, tags })
  }

  histogram(name: string, value: number, unit: string, tags?: Record<string, string>): void {
    this.histograms.push({ name, value, unit, tags })
  }

  /**
   * Reset all recorded telemetry.
   */
  reset(): void {
    this.counters = []
    this.gauges = []
    this.histograms = []
  }

  /**
   * Find histograms by name.
   */
  getHistogramsByName(name: string): HistogramRecord[] {
    return this.histograms.filter((h) => h.name === name)
  }

  /**
   * Find counters by name.
   */
  getCountersByName(name: string): CounterRecord[] {
    return this.counters.filter((c) => c.name === name)
  }

  /**
   * Check if a specific histogram was recorded.
   */
  wasHistogramRecorded(name: string, tags?: Partial<Record<string, string>>): boolean {
    return this.histograms.some((h) => {
      if (h.name !== name) return false
      if (!tags) return true
      return Object.entries(tags).every(([key, val]) => h.tags?.[key] === val)
    })
  }

  /**
   * Check if a specific counter was incremented.
   */
  wasCounterIncremented(name: string, tags?: Partial<Record<string, string>>): boolean {
    return this.counters.some((c) => {
      if (c.name !== name) return false
      if (!tags) return true
      return Object.entries(tags).every(([key, val]) => c.tags?.[key] === val)
    })
  }
}
