import { randomUUID } from 'node:crypto';

/** Short, sortable, collision-safe id: <prefix>_<base36 time><random>. */
export function newId(prefix: string): string {
  const t = Date.now().toString(36);
  const r = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${prefix}_${t}${r}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Stable slug used to deduplicate candidates discovered under different names. */
export function slug(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
