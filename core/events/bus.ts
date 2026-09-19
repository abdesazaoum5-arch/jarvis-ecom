import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { EventKind, JarvisEvent } from '../types/index.ts';
import { newId, nowIso } from '../util/id.ts';
import { PATHS } from '../util/paths.ts';
import { ensureStateDir } from '../state/store.ts';

/**
 * Append-only event log + in-process fan-out.
 *
 * Every meaningful operation emits an event. The command center's timeline is a
 * projection of this log, which means the operator sees exactly what happened —
 * the UI cannot show activity that the system did not record.
 */

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

const RING_MAX = 500;
const ring: JarvisEvent[] = [];

let stream: fs.WriteStream | null = null;

/**
 * The log's location, resolved at call time. A test run points this at a
 * scratch directory: the operator's timeline is a record of what the system
 * did, and a test's events appearing there would make it a false record.
 */
export function logFile(): string {
  return path.join(process.env['JARVIS_LOG_DIR'] ?? PATHS.logs, 'events.ndjson');
}

function logStream(): fs.WriteStream {
  if (!stream) {
    ensureStateDir();
    const file = logFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    stream = fs.createWriteStream(file, { flags: 'a' });
  }
  return stream;
}

export interface EmitInput {
  kind: EventKind;
  message: string;
  agent?: string | null;
  missionId?: string | null;
  target?: JarvisEvent['target'];
  data?: Record<string, unknown> | null;
  level?: JarvisEvent['level'];
}

const SECRET_KEYS = /(key|token|secret|password|cookie|authorization|credential)/i;

/** Defence in depth: no event payload may carry a credential to the browser. */
function redact(data: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = SECRET_KEYS.test(k) ? '[redacted]' : v;
  }
  return out;
}

export function emit(input: EmitInput): JarvisEvent {
  const event: JarvisEvent = {
    id: newId('evt'),
    at: nowIso(),
    kind: input.kind,
    message: input.message,
    agent: input.agent ?? null,
    missionId: input.missionId ?? null,
    target: input.target ?? null,
    data: redact(input.data),
    level: input.level ?? 'info',
  };
  seen.add(event.id);
  ring.push(event);
  if (ring.length > RING_MAX) ring.shift();
  try {
    logStream().write(`${JSON.stringify(event)}\n`);
  } catch {
    /* logging must never break the mission */
  }
  emitter.emit('event', event);
  return event;
}

/** Ids already in the ring, so an event is never shown to the operator twice. */
const seen = new Set<string>();

/**
 * Accepts an event that was emitted by another process and read back from the
 * log. It joins the ring and the live stream exactly as a local event does, but
 * is never written to the log again: the process that emitted it already did.
 *
 * Without this, work running outside the command center — a mission started
 * from the command line — would be invisible in the interface, which would make
 * the timeline a partial account of what the system did.
 */
export function ingest(event: JarvisEvent): boolean {
  if (seen.has(event.id)) return false;
  seen.add(event.id);
  if (seen.size > RING_MAX * 4) for (const id of [...seen].slice(0, RING_MAX)) seen.delete(id);
  ring.push(event);
  if (ring.length > RING_MAX) ring.shift();
  emitter.emit('event', event);
  return true;
}

export function recent(limit = 200): JarvisEvent[] {
  return ring.slice(-limit);
}

export function subscribe(fn: (e: JarvisEvent) => void): () => void {
  emitter.on('event', fn);
  return () => emitter.off('event', fn);
}

export async function closeLog(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!stream) return resolve();
    stream.end(resolve);
  });
  stream = null;
}
