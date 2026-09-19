import os from 'node:os';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from '../util/paths.ts';
import { pendingRequests } from '../research/bridge.ts';
import * as store from '../state/store.ts';

/**
 * System telemetry for the command center's monitor column.
 *
 * Every figure here is measured from this process, the file system, or stored
 * state. A metric that cannot be measured is reported as null with the reason,
 * and the interface renders it as UNKNOWN — the monitor is never padded with
 * plausible-looking numbers, because an operator who cannot trust one gauge
 * cannot trust any of them.
 */

export interface Metric {
  id: string;
  label: string;
  /** Measured value, or null when this host cannot report it. */
  value: number | null;
  /** Human-readable rendering of `value`, or the reason it is unknown. */
  display: string;
  /**
   * Position of `value` within a real, known range (0..1), for the bar. Null
   * when no denominator exists, in which case no bar is drawn: a bar implies a
   * ceiling, and inventing one would misstate the measurement.
   */
  fraction: number | null;
  tone: 'normal' | 'warn' | 'bad' | 'amber' | 'unknown';
}

export interface Telemetry {
  at: string;
  uptimeSeconds: number;
  metrics: Metric[];
}

/** Previous CPU sample, so usage is a real delta rather than a lifetime average. */
let lastCpu: { at: number; usage: NodeJS.CpuUsage } | null = null;

function cpuMetric(): Metric {
  const now = Date.now();
  const usage = process.cpuUsage();
  const previous = lastCpu;
  lastCpu = { at: now, usage };

  if (!previous || now - previous.at < 250) {
    return {
      id: 'cpu',
      label: 'Process CPU',
      value: null,
      display: previous ? 'SAMPLING' : 'UNKNOWN — no prior sample',
      fraction: null,
      tone: 'unknown',
    };
  }

  const elapsedMicros = (now - previous.at) * 1000;
  const usedMicros = usage.user - previous.usage.user + (usage.system - previous.usage.system);
  const cores = Math.max(1, os.cpus().length);
  const percent = Math.max(0, (usedMicros / elapsedMicros) * 100);
  return {
    id: 'cpu',
    label: 'Process CPU',
    value: percent,
    display: `${percent.toFixed(1)}%`,
    fraction: Math.min(1, percent / (cores * 100)),
    tone: percent > cores * 80 ? 'warn' : 'normal',
  };
}

function memoryMetric(): Metric {
  const rss = process.memoryUsage().rss;
  const total = os.totalmem();
  const mb = rss / (1024 * 1024);
  return {
    id: 'memory',
    label: 'Resident memory',
    value: mb,
    display: `${mb.toFixed(0)} MB`,
    fraction: total > 0 ? Math.min(1, rss / total) : null,
    tone: total > 0 && rss / total > 0.8 ? 'warn' : 'normal',
  };
}

function loadMetric(): Metric {
  const cores = Math.max(1, os.cpus().length);
  const [one] = os.loadavg();
  // Every platform returns the tuple; only Linux populates it meaningfully.
  if (one === undefined || (one === 0 && os.platform() === 'win32')) {
    return { id: 'load', label: 'Host load', value: null, display: 'UNKNOWN — not reported by host', fraction: null, tone: 'unknown' };
  }
  return {
    id: 'load',
    label: 'Host load (1m)',
    value: one,
    display: one.toFixed(2),
    fraction: Math.min(1, one / cores),
    tone: one > cores ? 'warn' : 'normal',
  };
}

async function logMetric(): Promise<Metric> {
  const file = path.join(PATHS.logs, 'events.ndjson');
  try {
    const stat = await fsp.stat(file);
    const kb = stat.size / 1024;
    return {
      id: 'log',
      label: 'Event log',
      value: kb,
      display: kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`,
      fraction: null,
      tone: 'normal',
    };
  } catch {
    return { id: 'log', label: 'Event log', value: null, display: 'UNKNOWN — no log written yet', fraction: null, tone: 'unknown' };
  }
}

function queueMetric(): Metric {
  const pending = pendingRequests();
  return {
    id: 'queue',
    label: 'Research queue',
    value: pending.length,
    display: pending.length === 0 ? 'clear' : `${pending.length} awaiting answer`,
    fraction: null,
    tone: pending.length > 0 ? 'amber' : 'normal',
  };
}

interface AdapterRecord {
  id: string;
  status: string;
}

async function adapterMetric(): Promise<Metric> {
  const env = await store.read<{ adapters?: AdapterRecord[] } | null>('environment', null);
  const adapters = env?.adapters ?? [];
  if (adapters.length === 0) {
    return { id: 'adapters', label: 'Adapters', value: null, display: 'UNKNOWN — not probed yet', fraction: null, tone: 'unknown' };
  }
  const connected = adapters.filter((a) => a.status === 'CONNECTED').length;
  return {
    id: 'adapters',
    label: 'Adapters connected',
    value: connected,
    display: `${connected} of ${adapters.length}`,
    fraction: connected / adapters.length,
    tone: connected === adapters.length ? 'normal' : connected === 0 ? 'bad' : 'warn',
  };
}

interface CandidateRecord {
  evidence?: Array<{ source?: { url?: string } | null }>;
}

async function sourceMetric(): Promise<Metric> {
  const products = await store.read<{ candidates?: CandidateRecord[] } | null>('products', null);
  const candidates = products?.candidates ?? [];
  const hosts = new Set<string>();
  for (const c of candidates) {
    for (const e of c.evidence ?? []) {
      const url = e.source?.url;
      if (!url) continue;
      try {
        hosts.add(new URL(url).hostname.replace(/^www\./, ''));
      } catch {
        /* A malformed URL is not a source; it is simply not counted. */
      }
    }
  }
  return {
    id: 'sources',
    label: 'Distinct sources',
    value: hosts.size,
    display: hosts.size === 0 ? 'none yet' : `${hosts.size} host${hosts.size === 1 ? '' : 's'}`,
    fraction: null,
    tone: 'normal',
  };
}

export async function measure(): Promise<Telemetry> {
  const [log, adapters, sources] = await Promise.all([logMetric(), adapterMetric(), sourceMetric()]);
  return {
    at: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    metrics: [cpuMetric(), memoryMetric(), loadMetric(), adapters, queueMetric(), sources, log],
  };
}
