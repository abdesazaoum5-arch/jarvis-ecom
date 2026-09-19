import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from '../util/paths.ts';

/**
 * File-backed shared state. Every agent reads and writes through this store so
 * there is exactly one source of truth and every mutation is durable.
 *
 * Writes are atomic (tmp file + rename) and serialised per file, so a crash
 * mid-write can never leave a half-written state document behind.
 */

export type StateFile =
  | 'mission'
  | 'products'
  | 'suppliers'
  | 'competitors'
  | 'economics'
  | 'brand'
  | 'creatives'
  | 'campaigns'
  | 'analytics'
  | 'permissions'
  | 'environment'
  | 'memory';

const queues = new Map<string, Promise<unknown>>();

function filePath(name: StateFile): string {
  return path.join(PATHS.state, `${name}.json`);
}

export function ensureStateDir(): void {
  fs.mkdirSync(PATHS.state, { recursive: true });
  fs.mkdirSync(PATHS.logs, { recursive: true });
}

/** Read a state document, returning `fallback` when it does not exist yet. */
export async function read<T>(name: StateFile, fallback: T): Promise<T> {
  try {
    const raw = await fsp.readFile(filePath(name), 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

export function readSync<T>(name: StateFile, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeAtomic(name: StateFile, value: unknown): Promise<void> {
  ensureStateDir();
  const target = filePath(name);
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, target);
}

/**
 * Read-modify-write under a per-file queue. Concurrent agents mutating the same
 * document are serialised rather than clobbering each other.
 */
export async function update<T>(name: StateFile, fallback: T, fn: (current: T) => T | Promise<T>): Promise<T> {
  const prev = queues.get(name) ?? Promise.resolve();
  const next = prev.then(async () => {
    const current = await read<T>(name, fallback);
    const updated = await fn(structuredClone(current));
    await writeAtomic(name, updated);
    return updated;
  });
  queues.set(
    name,
    next.catch(() => undefined),
  );
  return next as Promise<T>;
}

export async function write<T>(name: StateFile, value: T): Promise<T> {
  return update<T>(name, value, () => value);
}

/** Wait for all queued writes to land — used on shutdown and in tests. */
export async function flush(): Promise<void> {
  await Promise.allSettled([...queues.values()]);
}
