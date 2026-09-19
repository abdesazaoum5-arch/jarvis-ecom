import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AdapterStatus } from '../types/index.ts';
import type { PageRead, ResearchOptions, ResearchProvider, SearchHit } from './types.ts';
import { newId, nowIso } from '../util/id.ts';
import { PATHS } from '../util/paths.ts';
import { emit } from '../events/bus.ts';

/**
 * The Claude research bridge.
 *
 * Where the container's network policy blocks the open web, the research still
 * has to be real. This provider writes a request to a file-backed queue; the
 * Claude session attached to this workspace performs the actual search or page
 * read with its own web tools and writes the findings back, including every
 * source URL and retrieval timestamp.
 *
 * If nobody answers within the deadline the request stays PENDING and the
 * provider returns nothing. It never invents a result to fill the gap — an
 * unanswered request becomes UNKNOWN evidence upstream.
 */

export interface BridgeRequest {
  id: string;
  at: string;
  kind: 'search' | 'read';
  query: string;
  url: string | null;
  question: string | null;
  /** Why this is being asked — helps whoever fulfils it stay on target. */
  purpose: string;
  agent: string;
  missionId: string | null;
  status: 'PENDING' | 'ANSWERED' | 'EXPIRED' | 'DECLINED';
}

export interface BridgeAnswer {
  id: string;
  answeredAt: string;
  hits?: SearchHit[];
  page?: { url: string; title: string | null; text: string; answer: string | null };
  /** Set when the fulfiller could not get the information. */
  unavailable?: string;
}

/*
 * The queue location is resolved per call rather than captured at import, so a
 * test run can be pointed at a scratch directory and never leave fabricated
 * requests in the operator's real queue.
 */
function bridgeRoot(): string {
  return process.env['JARVIS_BRIDGE_DIR'] ?? path.join(PATHS.root, 'jarvis', 'bridge');
}

function reqDir(): string {
  return path.join(bridgeRoot(), 'requests');
}

function ansDir(): string {
  return path.join(bridgeRoot(), 'answers');
}

function ensureDirs(): void {
  fs.mkdirSync(reqDir(), { recursive: true });
  fs.mkdirSync(ansDir(), { recursive: true });
}

export function pendingRequests(): BridgeRequest[] {
  ensureDirs();
  return fs
    .readdirSync(reqDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(reqDir(), f), 'utf8')) as BridgeRequest)
    .filter((r) => r.status === 'PENDING')
    .sort((a, b) => a.at.localeCompare(b.at));
}

export async function answer(id: string, payload: Omit<BridgeAnswer, 'id' | 'answeredAt'>): Promise<void> {
  ensureDirs();
  const body: BridgeAnswer = { id, answeredAt: nowIso(), ...payload };
  await fsp.writeFile(path.join(ansDir(), `${id}.json`), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  const reqFile = path.join(reqDir(), `${id}.json`);
  if (fs.existsSync(reqFile)) {
    const req = JSON.parse(await fsp.readFile(reqFile, 'utf8')) as BridgeRequest;
    req.status = payload.unavailable ? 'DECLINED' : 'ANSWERED';
    await fsp.writeFile(reqFile, `${JSON.stringify(req, null, 2)}\n`, 'utf8');
  }
}

export class ClaudeBridgeProvider implements ResearchProvider {
  readonly id = 'research.claude-bridge';
  readonly #timeoutMs: number;

  constructor(timeoutMs = Number(process.env['JARVIS_BRIDGE_TIMEOUT_MS'] ?? 180_000)) {
    this.#timeoutMs = timeoutMs;
  }

  async status(): Promise<AdapterStatus> {
    ensureDirs();
    return 'CONNECTED';
  }

  async detail(): Promise<string> {
    const n = pendingRequests().length;
    return `Research requests are queued for the attached Claude session, which performs the search or page read and writes back sources and timestamps.${n ? ` ${n} request(s) awaiting an answer.` : ''}`;
  }

  async #ask(req: Omit<BridgeRequest, 'id' | 'at' | 'status'>): Promise<BridgeAnswer | null> {
    ensureDirs();
    const id = newId('req');
    const request: BridgeRequest = { ...req, id, at: nowIso(), status: 'PENDING' };
    await fsp.writeFile(path.join(reqDir(), `${id}.json`), `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    emit({
      kind: 'adapter',
      agent: req.agent,
      missionId: req.missionId,
      message:
        req.kind === 'search'
          ? `Requesting a web search: "${req.query}".`
          : `Requesting a page read: ${req.url}.`,
      target: { site: req.url ? safeHost(req.url) : 'web', url: req.url, action: 'bridge-request' },
      data: { requestId: id, purpose: req.purpose },
    });

    const deadline = Date.now() + this.#timeoutMs;
    const ansFile = path.join(ansDir(), `${id}.json`);
    while (Date.now() < deadline) {
      if (fs.existsSync(ansFile)) {
        const ans = JSON.parse(await fsp.readFile(ansFile, 'utf8')) as BridgeAnswer;
        if (ans.unavailable) {
          emit({ kind: 'adapter', level: 'warn', agent: req.agent, message: `Research request could not be fulfilled: ${ans.unavailable}`, data: { requestId: id } });
          return null;
        }
        return ans;
      }
      await sleep(750);
    }
    // Timed out. Mark it expired and return nothing — upstream records UNKNOWN.
    const reqFile = path.join(reqDir(), `${id}.json`);
    request.status = 'EXPIRED';
    await fsp.writeFile(reqFile, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    emit({
      kind: 'adapter',
      level: 'warn',
      agent: req.agent,
      message: `Research request timed out with no answer; recording this as UNKNOWN rather than guessing.`,
      data: { requestId: id },
    });
    return null;
  }

  async search(query: string, opts: ResearchOptions = {}): Promise<SearchHit[]> {
    const ans = await this.#ask({
      kind: 'search',
      query,
      url: null,
      question: null,
      purpose: opts.purpose ?? 'candidate discovery',
      agent: opts.agent ?? 'research',
      missionId: opts.missionId ?? null,
    });
    return (ans?.hits ?? []).slice(0, opts.limit ?? 10);
  }

  async read(url: string, question: string, opts: ResearchOptions = {}): Promise<PageRead | null> {
    const ans = await this.#ask({
      kind: 'read',
      query: question,
      url,
      question,
      purpose: opts.purpose ?? 'evidence gathering',
      agent: opts.agent ?? 'research',
      missionId: opts.missionId ?? null,
    });
    if (!ans?.page) return null;
    return {
      url: ans.page.url,
      title: ans.page.title,
      text: ans.page.text,
      answer: ans.page.answer,
      retrievedAt: ans.answeredAt,
      via: this.id,
      screenshot: null,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
