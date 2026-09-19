import fs from 'node:fs';
import path from 'node:path';
import type { AdapterStatus } from '../../../core/types/index.ts';
import type { PageRead, ResearchOptions, ResearchProvider, SearchHit } from '../../../core/research/types.ts';
import { findChromium, findPlaywright } from '../../../core/environment/probe.ts';
import { htmlToText, hostOf } from '../../../core/research/http.ts';
import { emit } from '../../../core/events/bus.ts';
import { newId, nowIso } from '../../../core/util/id.ts';
import { PATHS } from '../../../core/util/paths.ts';

/**
 * Computer/browser control. Real Playwright over the Chromium build discovered
 * in the environment — it opens pages, navigates, clicks, scrolls, types,
 * screenshots and extracts text, and it emits telemetry for every action so the
 * command center can show what the machine is doing right now.
 *
 * It never reports an action it did not perform: a navigation that the network
 * policy refuses surfaces as a failed step, not as a page read.
 */

type PwBrowser = { newContext(o?: unknown): Promise<PwContext>; close(): Promise<void>; version(): string };
type PwContext = { newPage(): Promise<PwPage>; close(): Promise<void>; pages(): PwPage[] };
export type PwPage = {
  goto(url: string, o?: unknown): Promise<unknown>;
  title(): Promise<string>;
  content(): Promise<string>;
  url(): string;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  click(sel: string, o?: unknown): Promise<void>;
  fill(sel: string, value: string, o?: unknown): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  mouse: { wheel(x: number, y: number): Promise<void> };
  close(): Promise<void>;
  setContent(html: string): Promise<void>;
};

export interface BrowserAction {
  kind: 'goto' | 'click' | 'type' | 'scroll' | 'screenshot' | 'extract' | 'wait';
  selector?: string;
  value?: string;
  url?: string;
  ms?: number;
}

export class BrowserAgent implements ResearchProvider {
  readonly id = 'browser.playwright';
  #browser: PwBrowser | null = null;
  #context: PwContext | null = null;
  #status: AdapterStatus = 'UNKNOWN';
  #detail = 'Not probed yet.';
  #egressOk: boolean | null = null;

  async status(): Promise<AdapterStatus> {
    if (this.#status === 'UNKNOWN') await this.probe();
    return this.#status;
  }

  async detail(): Promise<string> {
    if (this.#status === 'UNKNOWN') await this.probe();
    return this.#detail;
  }

  async probe(): Promise<AdapterStatus> {
    const entry = findPlaywright();
    const chrome = findChromium();
    if (!entry || !chrome) {
      this.#status = 'NOT_CONNECTED';
      this.#detail = !entry ? 'Playwright is not installed in this environment.' : 'No Chromium build found in this environment.';
      return this.#status;
    }
    try {
      await this.#ensure();
      // Prove the browser really renders before claiming it works.
      const page = await this.#newPage();
      await page.setContent('<h1 id="probe">ok</h1>');
      const html = await page.content();
      await page.close();
      if (!html.includes('probe')) throw new Error('renderer produced no content');
      this.#status = this.#egressOk === false ? 'DEGRADED' : 'CONNECTED';
      this.#detail =
        this.#egressOk === false
          ? `Chromium ${this.#browser?.version() ?? ''} renders and is fully controllable, but the environment's network policy blocks public sites, so it can only drive local pages.`
          : `Chromium ${this.#browser?.version() ?? ''} is controllable and public sites are reachable.`;
    } catch (err) {
      this.#status = 'NOT_CONNECTED';
      this.#detail = `Chromium failed to launch: ${(err as Error).message.slice(0, 160)}`;
    }
    return this.#status;
  }

  /** Records whether public egress works, so `probe` can report DEGRADED honestly. */
  setEgress(ok: boolean): void {
    this.#egressOk = ok;
    if (this.#status === 'CONNECTED' && !ok) this.#status = 'DEGRADED';
  }

  async #ensure(): Promise<void> {
    if (this.#browser) return;
    const entry = findPlaywright();
    if (!entry) throw new Error('playwright not found');
    const mod = (await import(entry)) as { chromium: { launch(o?: unknown): Promise<PwBrowser> } };
    const executablePath = findChromium();
    this.#browser = await mod.chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    this.#context = await this.#browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    });
  }

  async #newPage(): Promise<PwPage> {
    await this.#ensure();
    if (!this.#context) throw new Error('no browser context');
    return this.#context.newPage();
  }

  /** Runs a scripted sequence of real actions, emitting telemetry for each. */
  async drive(url: string, actions: BrowserAction[], opts: { agent?: string; missionId?: string } = {}): Promise<PageRead | null> {
    const agent = opts.agent ?? 'browser';
    let page: PwPage | null = null;
    try {
      page = await this.#newPage();
      emit({
        kind: 'action',
        agent,
        missionId: opts.missionId ?? null,
        message: `Opening ${hostOf(url)}.`,
        target: { site: hostOf(url), url, action: 'navigate' },
      });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      let shot: string | null = null;
      for (const a of actions) {
        switch (a.kind) {
          case 'goto':
            if (a.url) {
              emit({ kind: 'action', agent, message: `Navigating to ${hostOf(a.url)}.`, target: { site: hostOf(a.url), url: a.url, action: 'navigate' } });
              await page.goto(a.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            }
            break;
          case 'click':
            if (a.selector) {
              emit({ kind: 'action', agent, message: `Clicking ${a.selector}.`, target: { site: hostOf(page.url()), url: page.url(), action: 'click' } });
              await page.click(a.selector, { timeout: 10000 });
            }
            break;
          case 'type':
            if (a.selector) {
              emit({ kind: 'action', agent, message: `Entering a query.`, target: { site: hostOf(page.url()), url: page.url(), action: 'type' } });
              await page.fill(a.selector, a.value ?? '', { timeout: 10000 });
            }
            break;
          case 'scroll':
            await page.mouse.wheel(0, a.ms ?? 1200);
            break;
          case 'wait':
            await page.waitForTimeout(Math.min(a.ms ?? 500, 10000));
            break;
          case 'screenshot':
            shot = await this.#screenshot(page);
            break;
          case 'extract':
            break;
        }
      }
      if (!shot) shot = await this.#screenshot(page);
      const html = await page.content();
      const read: PageRead = {
        url: page.url(),
        title: await page.title().catch(() => null),
        text: htmlToText(html).slice(0, 20000),
        answer: null,
        retrievedAt: nowIso(),
        via: this.id,
        screenshot: shot,
      };
      emit({
        kind: 'action',
        agent,
        message: `Read ${hostOf(read.url)} (${read.text.length} characters).`,
        target: { site: hostOf(read.url), url: read.url, action: 'extracted' },
        data: { screenshot: shot },
      });
      return read;
    } catch (err) {
      emit({
        kind: 'error',
        agent,
        level: 'warn',
        message: `Could not read ${hostOf(url)}: ${(err as Error).message.slice(0, 140)}`,
        target: { site: hostOf(url), url, action: 'failed' },
      });
      return null;
    } finally {
      await page?.close().catch(() => undefined);
    }
  }

  async #screenshot(page: PwPage): Promise<string | null> {
    try {
      fs.mkdirSync(PATHS.screenshots, { recursive: true });
      const file = `${newId('shot')}.png`;
      await page.screenshot({ path: path.join(PATHS.screenshots, file) });
      return `/screenshots/${file}`;
    } catch {
      return null;
    }
  }

  async search(query: string, opts: ResearchOptions = {}): Promise<SearchHit[]> {
    const st = await this.status();
    if (st !== 'CONNECTED') return [];
    const read = await this.drive(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, [
      { kind: 'wait', ms: 1500 },
      { kind: 'screenshot' },
    ]);
    if (!read) return [];
    const hits: SearchHit[] = [];
    const re = /https?:\/\/[^\s"']+/g;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = re.exec(read.text)) && hits.length < (opts.limit ?? 10)) {
      const u = m[0];
      if (u.includes('duckduckgo.com') || seen.has(u)) continue;
      seen.add(u);
      hits.push({ title: hostOf(u), url: u, snippet: null });
    }
    return hits;
  }

  async read(url: string, _question: string, opts: ResearchOptions = {}): Promise<PageRead | null> {
    const st = await this.status();
    if (st === 'NOT_CONNECTED') return null;
    return this.drive(url, [{ kind: 'wait', ms: 800 }, { kind: 'screenshot' }], {
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(opts.missionId ? { missionId: opts.missionId } : {}),
    });
  }

  async close(): Promise<void> {
    await this.#context?.close().catch(() => undefined);
    await this.#browser?.close().catch(() => undefined);
    this.#context = null;
    this.#browser = null;
  }
}
