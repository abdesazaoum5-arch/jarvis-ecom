import type { AdapterStatus, SourceRef } from '../types/index.ts';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string | null;
}

export interface PageRead {
  url: string;
  title: string | null;
  /** Extracted readable text, truncated to a sane length. */
  text: string;
  /** Answer to the question the caller asked of the page, when the provider can. */
  answer: string | null;
  retrievedAt: string;
  via: string;
  screenshot: string | null;
}

/**
 * Context travels with every request: `purpose` tells whoever fulfils it what
 * the research is for, and `agent`/`missionId` tie the result back to the work
 * that asked for it. Dropping these would leave the bridge guessing.
 */
export interface ResearchOptions {
  limit?: number;
  site?: string;
  purpose?: string;
  agent?: string;
  missionId?: string | null;
}

export interface ResearchProvider {
  readonly id: string;
  status(): Promise<AdapterStatus>;
  /** Why the provider is in that status, in the operator's words. */
  detail(): Promise<string>;
  search(query: string, opts?: ResearchOptions): Promise<SearchHit[]>;
  read(url: string, question: string, opts?: ResearchOptions): Promise<PageRead | null>;
}

export function sourceFrom(page: PageRead, excerpt: string | null = null): SourceRef {
  return { url: page.url, title: page.title, retrievedAt: page.retrievedAt, via: page.via, excerpt };
}
