import type { AdapterReport } from '../types/index.ts';
import type { PageRead, ResearchOptions, ResearchProvider, SearchHit } from './types.ts';
import { HttpProvider } from './http.ts';
import { ClaudeBridgeProvider } from './bridge.ts';
import { BrowserAgent } from '../../apps/browser-agent/src/browser.ts';
import { emit } from '../events/bus.ts';
import { nowIso } from '../util/id.ts';

/**
 * Chooses a research path at call time based on what is actually working.
 *
 * Order of preference: direct HTTP (cheapest), then the browser (needed for
 * pages that only render with JavaScript), then the Claude bridge. Every result
 * records which provider produced it, so a claim can always be traced back to
 * the mechanism that retrieved it.
 */
export class ResearchRouter {
  readonly http = new HttpProvider();
  readonly browser = new BrowserAgent();
  readonly bridge = new ClaudeBridgeProvider();
  #ready = false;
  /**
   * Research is finite: every request costs time and, on some paths, a human's
   * attention. The budget caps a mission's requests and, once spent, the router
   * returns nothing so the agents record UNKNOWN. It never quietly keeps going,
   * and it never substitutes a cheaper guess for the request it did not make.
   */
  #budget = Number.POSITIVE_INFINITY;
  #spent = 0;
  /**
   * Per-agent reserves. Without them the first stage of a mission spends the
   * whole budget on the first thing it looks at, and every later stage — the
   * one that would have established a supplier price or a competitor's asking
   * price — finds nothing left and records UNKNOWN. A reserve is a stage's own
   * allowance that earlier stages cannot touch.
   */
  #reserved = new Map<string, number>();
  #usedByAgent = new Map<string, number>();
  /** What remains after the reserves: drawn on by any stage, first come. */
  #shared = Number.POSITIVE_INFINITY;

  /**
   * @param requests total requests this mission may make.
   * @param allocation share of the total each agent gets exclusively, keyed by
   * agent name. Shares are clamped so they can never exceed the total; whatever
   * is left over is shared. Omit it to let every stage draw from one pool.
   */
  setBudget(requests: number, allocation: Record<string, number> = {}): void {
    this.#budget = requests;
    this.#spent = 0;
    this.#reserved.clear();
    this.#usedByAgent.clear();

    if (requests === Number.POSITIVE_INFINITY) {
      this.#shared = Number.POSITIVE_INFINITY;
      return;
    }

    let allocated = 0;
    for (const [agent, share] of Object.entries(allocation)) {
      if (share <= 0) continue;
      // Every reserved stage gets at least one request: a share that rounds to
      // zero would silently mean "this stage never runs".
      const want = Math.max(1, Math.floor(requests * share));
      const give = Math.min(want, Math.max(0, requests - allocated));
      if (give === 0) continue;
      this.#reserved.set(agent, give);
      allocated += give;
    }
    this.#shared = Math.max(0, requests - allocated);
  }

  get spent(): number {
    return this.#spent;
  }

  get remaining(): number {
    return this.#budget === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(0, this.#budget - this.#spent);
  }

  /** What this agent may still spend: its own reserve plus the shared pool. */
  remainingFor(agent: string): number {
    if (this.#budget === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
    const reserve = this.#reserved.get(agent) ?? 0;
    const used = this.#usedByAgent.get(agent) ?? 0;
    return Math.max(0, reserve - used) + this.#shared;
  }

  #spend(what: string, agent: string | undefined): boolean {
    const who = agent ?? 'research';
    if (this.#budget === Number.POSITIVE_INFINITY) {
      this.#spent += 1;
      return true;
    }

    const reserve = this.#reserved.get(who) ?? 0;
    const used = this.#usedByAgent.get(who) ?? 0;
    // A stage spends its own reserve first, and only then the shared pool.
    if (used < reserve) {
      this.#usedByAgent.set(who, used + 1);
      this.#spent += 1;
      return true;
    }
    if (this.#shared > 0) {
      this.#shared -= 1;
      this.#usedByAgent.set(who, used + 1);
      this.#spent += 1;
      return true;
    }

    emit({
      kind: 'adapter',
      level: 'warn',
      agent: who,
      message: reserve > 0
        ? `${who} has spent its research allowance (${reserve} requests) and the shared pool is empty. Skipping ${what}; anything it would have established stays UNKNOWN.`
        : `Research budget spent (${this.#budget} requests). Skipping ${what}; anything it would have established stays UNKNOWN.`,
    });
    return false;
  }

  async init(): Promise<AdapterReport[]> {
    const httpStatus = await this.http.probe();
    this.browser.setEgress(httpStatus === 'CONNECTED');
    const browserStatus = await this.browser.probe();
    this.#ready = true;
    const reports: AdapterReport[] = [
      { id: this.http.id, kind: 'research', status: httpStatus, detail: await this.http.detail(), remedy: httpStatus === 'CONNECTED' ? null : "Allow the public web in this environment's network policy.", checkedAt: nowIso(), free: true },
      { id: this.browser.id, kind: 'browser', status: browserStatus, detail: await this.browser.detail(), remedy: browserStatus === 'DEGRADED' ? "Allow the public web in this environment's network policy." : null, checkedAt: nowIso(), free: true },
      { id: this.bridge.id, kind: 'research', status: await this.bridge.status(), detail: await this.bridge.detail(), remedy: null, checkedAt: nowIso(), free: true },
    ];
    for (const r of reports) {
      emit({ kind: 'adapter', message: `${r.id}: ${r.status}. ${r.detail}`, data: { adapter: r.id, status: r.status }, level: r.status === 'NOT_CONNECTED' ? 'warn' : 'info' });
    }
    return reports;
  }

  async #providers(): Promise<ResearchProvider[]> {
    if (!this.#ready) await this.init();
    const out: ResearchProvider[] = [];
    if ((await this.http.status()) === 'CONNECTED') out.push(this.http);
    if ((await this.browser.status()) === 'CONNECTED') out.push(this.browser);
    out.push(this.bridge);
    return out;
  }

  async search(query: string, opts: ResearchOptions = {}): Promise<SearchHit[]> {
    if (!this.#spend(`search "${query}"`, opts.agent)) return [];
    for (const p of await this.#providers()) {
      const hits = await p.search(query, opts);
      if (hits.length) return hits;
    }
    emit({ kind: 'adapter', level: 'warn', agent: opts.agent ?? 'research', message: `No research provider returned results for "${query}".` });
    return [];
  }

  async read(url: string, question: string, opts: ResearchOptions = {}): Promise<PageRead | null> {
    if (!this.#spend(`a read of ${url}`, opts.agent)) return null;
    for (const p of await this.#providers()) {
      const page = await p.read(url, question, opts);
      if (page && page.text.trim().length > 0) return page;
    }
    return null;
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

export const research = new ResearchRouter();
