import fs from 'node:fs';
import type { JarvisEvent } from '../types/index.ts';
import { ingest, logFile } from './bus.ts';

/**
 * Follows the append-only event log so events emitted by other processes — a
 * mission run from the command line, a browser agent in its own process — reach
 * the command center's live stream.
 *
 * The log is the system's record of what happened. Tailing it, rather than
 * requiring every worker to hold a socket open, means the interface shows the
 * whole of that record and not just the part that happened to share a process.
 */

const LOG = logFile;

export interface Tail {
  stop(): void;
}

/** Reads from `offset` to the end of the file, ingesting whole lines only. */
function drain(from: number, carry: string): { offset: number; carry: string } {
  let size: number;
  try {
    size = fs.statSync(LOG()).size;
  } catch {
    return { offset: from, carry };
  }
  // A truncated or rotated log restarts from the beginning rather than seeking
  // past the end of a shorter file.
  if (size < from) return { offset: 0, carry: '' };
  if (size === from) return { offset: from, carry };

  const fd = fs.openSync(LOG(), 'r');
  try {
    const buffer = Buffer.alloc(size - from);
    fs.readSync(fd, buffer, 0, buffer.length, from);
    const chunk = carry + buffer.toString('utf8');
    const lines = chunk.split('\n');
    // The final element is whatever follows the last newline: a partial line if
    // a writer is mid-write, which is held over rather than parsed.
    const rest = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        ingest(JSON.parse(line) as JarvisEvent);
      } catch {
        /* A half-written line is skipped; the next pass sees it complete. */
      }
    }
    return { offset: size, carry: rest };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Starts following the log. Existing lines are skipped: the ring already holds
 * this process's recent events, and replaying the whole history on boot would
 * show the operator an hour-old event as if it had just happened.
 */
export function followLog(intervalMs = 700): Tail {
  let offset = 0;
  let carry = '';
  try {
    offset = fs.statSync(LOG()).size;
  } catch {
    offset = 0;
  }

  const timer = setInterval(() => {
    const next = drain(offset, carry);
    offset = next.offset;
    carry = next.carry;
  }, intervalMs);
  timer.unref();

  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
