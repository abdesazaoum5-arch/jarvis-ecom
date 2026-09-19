import type { PageRead } from './types.ts';

/**
 * Structured extraction from a retrieved page.
 *
 * Research requests carry an explicit field list, and whoever fulfils the
 * request answers with JSON containing only what the page actually says. Fields
 * the page does not support must come back as null — the parser below treats a
 * missing or null field as UNKNOWN and never substitutes a value.
 */

export interface FieldSpec {
  name: string;
  /** Shown to the fulfiller so the right thing is looked for. */
  describe: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
}

export function questionFor(purpose: string, fields: FieldSpec[]): string {
  const lines = fields.map((f) => `  "${f.name}": ${jsonType(f.type)}  // ${f.describe}`);
  return [
    `${purpose}`,
    '',
    'Answer with a single JSON object and nothing else:',
    '{',
    lines.join(',\n'),
    '}',
    '',
    'Rules: use only what this page actually states. Any field the page does not support must be null.',
    'Do not estimate, infer or fill in a plausible value. Quote prices as plain numbers in the page currency.',
  ].join('\n');
}

function jsonType(t: FieldSpec['type']): string {
  switch (t) {
    case 'number':
      return 'number | null';
    case 'boolean':
      return 'boolean | null';
    case 'string[]':
      return 'string[]';
    default:
      return 'string | null';
  }
}

/** Parses the fulfiller's answer, tolerating fenced code blocks and prose around it. */
export function parseAnswer(page: PageRead | null): Record<string, unknown> | null {
  if (!page?.answer) return null;
  const raw = page.answer.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)?.[1];
  const body = (fenced ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function str(o: Record<string, unknown> | null, key: string): string | null {
  const v = o?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function num(o: Record<string, unknown> | null, key: string): number | null {
  const v = o?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = /-?\d+(?:[.,]\d+)?/.exec(v.replace(/\s/g, ''));
    if (m) {
      const n = Number(m[0].replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

export function bool(o: Record<string, unknown> | null, key: string): boolean | null {
  const v = o?.[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^(yes|true|ja)$/i.test(v)) return true;
    if (/^(no|false|nee)$/i.test(v)) return false;
  }
  return null;
}

export function list(o: Record<string, unknown> | null, key: string): string[] {
  const v = o?.[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}
