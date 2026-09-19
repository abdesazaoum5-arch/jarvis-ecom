import type { AdapterStatus } from '../types/index.ts';
import type { PageRead, ResearchOptions, ResearchProvider, SearchHit } from './types.ts';
import { nowIso } from '../util/id.ts';
import { emit } from '../events/bus.ts';

/** Strips markup to readable text without pulling in a parser dependency. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function pageTitle(html: string): string | null {
  return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
}

/**
 * Direct HTTP research. Reports its real status: when the environment's egress
 * policy blocks public hosts this provider is NOT_CONNECTED and returns nothing
 * rather than pretending to have read a page.
 */
export class HttpProvider implements ResearchProvider {
  readonly id = 'research.http';
  #status: AdapterStatus = 'UNKNOWN';
  #detail = 'Not probed yet.';

  async status(): Promise<AdapterStatus> {
    if (this.#status === 'UNKNOWN') await this.probe();
    return this.#status;
  }

  async detail(): Promise<string> {
    if (this.#status === 'UNKNOWN') await this.probe();
    return this.#detail;
  }

  async probe(): Promise<AdapterStatus> {
    try {
      const res = await fetch('https://duckduckgo.com/', { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) });
      const deny = res.headers.get('x-deny-reason');
      if (deny) {
        this.#status = 'NOT_CONNECTED';
        this.#detail = `Egress gateway refused the host (${deny}). Public sites are outside this environment's network policy.`;
      } else {
        this.#status = 'CONNECTED';
        this.#detail = `Public web reachable (HTTP ${res.status}).`;
      }
    } catch (err) {
      this.#status = 'NOT_CONNECTED';
      this.#detail = `No direct egress: ${(err as Error).message.slice(0, 120)}`;
    }
    return this.#status;
  }

  async search(query: string, opts: ResearchOptions = {}): Promise<SearchHit[]> {
    if ((await this.status()) !== 'CONNECTED') return [];
    const q = opts.site ? `${query} site:${opts.site}` : query;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    emit({ kind: 'action', agent: 'research', message: `Searching the web for "${q}".`, target: { site: 'duckduckgo.com', url, action: 'search' } });
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) return [];
      const html = await res.text();
      const hits: SearchHit[] = [];
      const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) && hits.length < (opts.limit ?? 10)) {
        const href = decodeDdg(m[1] ?? '');
        if (!href) continue;
        hits.push({ title: htmlToText(m[2] ?? ''), url: href, snippet: null });
      }
      return hits;
    } catch {
      return [];
    }
  }

  async read(url: string, _question: string, _opts: ResearchOptions = {}): Promise<PageRead | null> {
    if ((await this.status()) !== 'CONNECTED') return null;
    emit({ kind: 'action', agent: 'research', message: `Reading ${hostOf(url)}.`, target: { site: hostOf(url), url, action: 'read' } });
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25000) });
      if (!res.ok) return null;
      const html = await res.text();
      return {
        url,
        title: pageTitle(html),
        text: htmlToText(html).slice(0, 20000),
        answer: null,
        retrievedAt: nowIso(),
        via: this.id,
        screenshot: null,
      };
    } catch {
      return null;
    }
  }
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function decodeDdg(href: string): string | null {
  try {
    if (href.startsWith('//duckduckgo.com/l/') || href.includes('duckduckgo.com/l/')) {
      const u = new URL(href.startsWith('//') ? `https:${href}` : href);
      return u.searchParams.get('uddg');
    }
    return href.startsWith('http') ? href : null;
  } catch {
    return null;
  }
}
