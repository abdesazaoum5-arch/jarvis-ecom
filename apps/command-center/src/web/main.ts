/**
 * Command center controller.
 *
 * Boots the interface, subscribes to the live event stream, and projects state
 * into the panels. It renders only what the server reports: a panel that shows
 * a number has been given that number by the system that measured it.
 */

import { runBoot, BOOT_DURATION } from './boot.ts';
import { Orb, type OrbState } from './orb.ts';
import { NodeField, type NodeStage } from './nodes.ts';
import { confirmMicrophone, detect, Voice, WakeListener } from './voice.ts';

interface Snapshot {
  mission: MissionView | null;
  products: CandidateView[];
  permissions: { level: number; levels: Record<string, string>; spendingAuthorised: unknown };
  environment: { adapters?: AdapterView[]; notes?: string[] } | null;
  events: EventView[];
}

interface MissionView {
  id: string;
  objective: string;
  status: string;
  progress: number;
  control: string;
  createdAt: string;
  activeAgents: string[];
  stages: Array<{ id: string; label: string; status: string; inCount: number | null; outCount: number | null; note: string | null }>;
}

interface CandidateView {
  id: string;
  name: string;
  stage: NodeStage;
  score: { total: number | null; coverage: number; confidence: string } | null;
  rejection: { reason: string } | null;
  economics: { currency: string; fullyGrounded: boolean; scenarios: Array<{ label: string; contributionBeforeAds: number; breakEvenCpa: number; breakEvenRoas: number }> } | null;
  competition: { saturation: { value: string | null; provenance: string } } | null;
  trend: { momentum: { value: string | null; provenance: string } } | null;
  evidence: Array<{ claim: string; provenance: string; source: { url: string; title: string | null } | null }>;
  description: string | null;
}

interface MetricView {
  id: string;
  label: string;
  value: number | null;
  display: string;
  fraction: number | null;
  tone: 'normal' | 'warn' | 'bad' | 'amber' | 'unknown';
}

interface TelemetryView {
  at: string;
  uptimeSeconds: number;
  metrics: MetricView[];
}

interface AdapterView {
  id: string;
  status: string;
  detail: string;
  remedy: string | null;
}

interface EventView {
  id: string;
  at: string;
  kind: string;
  message: string;
  agent: string | null;
  level: string;
  target: { site: string | null; url: string | null; action: string | null } | null;
  data: Record<string, unknown> | null;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const prefersStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;
if (prefersStill) root.dataset['motion'] = 'off';

/**
 * Two presences of the same system: the large orb at rest, and the docked one
 * inside the command center. Both read the same state, so JARVIS looks like one
 * thing whichever screen you are on.
 */
const restOrb = new Orb($<HTMLCanvasElement>('rest-canvas'), { still: prefersStill });
/*
 * The core is the instrument form: a lit sphere carrying the readable rings and
 * arcs. The resting presence stays the particle form, so the two states of the
 * system are distinguishable at a glance.
 */
const core = new Orb($<HTMLCanvasElement>('core-canvas'), { still: prefersStill, form: 'ringed' });
/** The presence in the working view: the same system, seen while it drives. */
const workOrb = new Orb($<HTMLCanvasElement>('takeover-orb'), { still: prefersStill, form: 'ringed' });
const field = new NodeField($<HTMLCanvasElement>('node-canvas'), prefersStill);

let seenEvents = new Set<string>();
let renderedCandidates = new Map<string, string>();
let missionStart: number | null = null;

/* ------------------------------------------------------------------ boot */

const bootStop = runBoot($<HTMLCanvasElement>('boot-canvas'), $('boot-line'), finishBoot, prefersStill);
$('boot-skip').addEventListener('click', () => {
  bootStop();
  finishBoot();
});

let booted = false;
function finishBoot(): void {
  if (booted) return;
  booted = true;
  $('boot').classList.add('done');
  // JARVIS comes up at rest, not on a dashboard.
  $('rest').classList.add('live');
  restOrb.start();
  core.start();
  workOrb.start();
  field.start();
  setView('rest');
  $('rest-utterance').focus();
  tickClock();
  void refresh();
  connect();
}

/* --------------------------------------------------------------- rest */

/**
 * Three views, and only ever one of them.
 *
 * `rest`  — presence alone: the orb, the time, and one line saying nothing is
 *           running. This is where JARVIS lives when it is not working.
 * `takeover` — the machine's own screen, full bleed, with one line naming what
 *           it is doing. This is what "watch it work" means.
 * `detail` — the panels, on request only.
 *
 * The operator asked for a system that is present rather than a screen full of
 * text, so nothing appears unless it is either the work itself or something
 * they asked to see.
 */
type View = 'rest' | 'takeover' | 'detail';

let view: View = 'rest';
// Stamped up front so the view is never unset while the page is being read.
root.dataset['view'] = view;

function setView(next: View): void {
  if (view === next) return;
  view = next;
  root.dataset['view'] = next;

  $('rest').classList.toggle('gone', next !== 'rest');
  // Focus follows the view. Left behind in a hidden field, every keystroke goes
  // somewhere the operator cannot see.
  const focused = document.activeElement as HTMLElement | null;
  if (focused && focused !== document.body && next !== 'detail') focused.blur();
  // The presence is wherever the operator is looking.
  restOrb.docked = next !== 'rest';
  workOrb.docked = false;
  core.docked = false;

  if (next === 'detail') {
    $('shell').classList.add('live', 'emerging');
    window.setTimeout(() => $('shell').classList.remove('emerging'), 950);
    $('utterance').focus();
  } else {
    closeTyping();
  }
}

/** True while there is work to watch; false when JARVIS is at rest. */
let working = false;

function enterWork(): void {
  working = true;
  $('takeover').classList.add('working');
  // A detail view the operator opened themselves is not taken away from them.
  if (view !== 'detail') setView('takeover');
}

/* ------------------------------------------------------------- typing */

/*
 * The typing field is summoned, not permanent. Voice can ask for it, but so can
 * any key and any tap: if speech is unavailable — a blocked microphone, no
 * speech service — the operator must still be able to reach the system.
 */
function openTyping(): void {
  $('takeover').classList.add('typing');
  ($('takeover-utterance') as HTMLInputElement).focus();
}

function closeTyping(): void {
  const field = $('takeover-utterance') as HTMLInputElement;
  if (field.value.trim().length > 0) return;
  $('takeover').classList.remove('typing');
}

/** Collapses back to presence once there is nothing left to show. */
function enterRest(): void {
  working = false;
  $('takeover').classList.remove('working');
  $('shell').classList.remove('live');
  setView('rest');
  $('rest-utterance').focus();
}

function tickClock(): void {
  const d = new Date();
  $('hud-clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  $('rest-clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  $('rest-date').textContent = d
    .toLocaleDateString(navigator.language || 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase();
}
setInterval(tickClock, 1000);
// Safety net: the interface must never be trapped behind its own animation.
setTimeout(finishBoot, BOOT_DURATION + 900);

/* --------------------------------------------------------------- stream */

function connect(): void {
  const es = new EventSource('/api/events');
  es.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as EventView;
      pushEvent(event);
    } catch {
      /* a malformed frame must not break the stream */
    }
  };
  es.onerror = () => {
    setStat('s-system', 'reconnecting', 'warn');
  };
  es.onopen = () => setStat('s-system', 'online', 'ok');
}

let refreshTimer: number | null = null;
/** Coalesces state refreshes so a burst of events costs one fetch. */
function scheduleRefresh(): void {
  if (refreshTimer !== null) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, 450);
}

async function refresh(): Promise<void> {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    render((await res.json()) as Snapshot);
  } catch {
    /* the stream will bring us back */
  }
}

/* --------------------------------------------------------------- render */

function render(s: Snapshot): void {
  renderStatus(s);
  renderMission(s.mission);
  renderIntel(s.products);
  field.sync(
    s.products.map((c) => ({
      id: c.id,
      name: c.name,
      stage: c.stage,
      score: c.score?.total ?? null,
      reason: c.rejection?.reason ?? null,
    })),
  );
  const state = coreStateFor(s);
  core.state = state;
  restOrb.state = state;
  workOrb.state = state;
  // At rest the operator is told plainly that nothing is running.
  $('rest-state').textContent = s.mission
    ? `${s.mission.status.toLowerCase()} · ${s.mission.progress}%`
    : 'all systems idle';
  // The command center exists while there is work to show, and not otherwise.
  const busy = !!s.mission && !['COMPLETE', 'STOPPED', 'FAILED', 'IDLE'].includes(s.mission.status);
  if (busy) enterWork();
  else if (working) enterRest();
}

function coreStateFor(s: Snapshot): OrbState {
  const m = s.mission;
  if (!m) return 'STANDBY';
  if (m.control === 'PAUSE' || m.status === 'PAUSED') return 'PAUSED';
  if (m.status === 'FAILED') return 'ERROR';
  if (m.status === 'COMPLETE') return 'COMPLETE';
  if (m.status === 'STOPPED') return 'STANDBY';
  if (m.status === 'INTERPRETING') return 'THINKING';
  if (m.status === 'BUILDING') return 'EXECUTING';
  return 'RESEARCHING';
}

function setStat(id: string, text: string, tone: '' | 'ok' | 'warn' | 'bad' = ''): void {
  const el = $(id);
  el.textContent = text;
  el.className = `v${tone ? ` ${tone}` : ''}`;
}

function renderStatus(s: Snapshot): void {
  const level = s.permissions.level;
  setStat('s-perm', `${level} · ${(s.permissions.levels[String(level)] ?? '').toLowerCase()}`, level === 0 ? '' : 'warn');

  const adapters = s.environment?.adapters ?? [];
  const byId = (id: string) => adapters.find((a) => a.id === id);
  const research = byId('research.claude-bridge') ?? byId('research.http');
  const browser = byId('browser.playwright');
  setStat('s-research', research ? research.status.toLowerCase().replace('_', ' ') : '—', toneOf(research?.status));
  setStat('s-browser', browser ? browser.status.toLowerCase().replace('_', ' ') : '—', toneOf(browser?.status));

  const chips = adapters
    .filter((a) => a.status !== 'CONNECTED')
    .map((a) => `<span class="chip ${toneOf(a.status)}" title="${escape(a.detail)}${a.remedy ? ` — ${escape(a.remedy)}` : ''}">${escape(shortName(a.id))}: ${a.status.toLowerCase().replace('_', ' ')}</span>`);
  $('adapters').innerHTML = chips.join(' ');

  const sources = new Set<string>();
  for (const c of s.products) for (const e of c.evidence) if (e.source) sources.add(hostOf(e.source.url));
  $('s-sources').textContent = String(sources.size);
}

function toneOf(status: string | undefined): '' | 'ok' | 'warn' | 'bad' {
  if (status === 'CONNECTED') return 'ok';
  if (status === 'DEGRADED') return 'warn';
  if (status === 'NOT_CONNECTED') return 'bad';
  return '';
}

function shortName(id: string): string {
  return id.split('.').pop() ?? id;
}

function renderMission(m: MissionView | null): void {
  const body = $('mission-body');
  $('mission-status').textContent = m ? m.status.toLowerCase() : 'idle';
  if (!m) {
    body.innerHTML = '<p class="empty">No mission is running. Give JARVIS an objective in the command bar.</p>';
    missionStart = null;
    $('s-elapsed').textContent = '—';
    return;
  }
  missionStart = new Date(m.createdAt).getTime();

  const stages = m.stages
    .map((st) => {
      const cls = st.status === 'ACTIVE' ? 'active' : st.status === 'DONE' ? 'done' : '';
      const count = st.inCount !== null || st.outCount !== null ? `${st.inCount ?? '—'} → ${st.outCount ?? '—'}` : '';
      return `<div class="stage-row ${cls}"><span class="dot"></span><span>${escape(st.label)}</span><span class="count">${count}</span></div>`;
    })
    .join('');

  const agents = ['research', 'trend', 'market', 'competitor', 'customer', 'supplier', 'economics', 'compliance', 'brand', 'shopify', 'cro', 'creative', 'video', 'ads', 'analytics', 'learning']
    .map((a) => `<span class="agent-pill ${m.activeAgents.includes(a) ? 'on' : ''}">${a}</span>`)
    .join('');

  body.innerHTML = `
    <div class="mission-line"><span class="k">Mission</span><span class="v">${escape(m.objective)}</span></div>
    <div class="mission-line"><span class="k">Status</span><span class="v">${escape(m.status.toLowerCase())}${m.control !== 'RUN' ? ` · ${escape(m.control.toLowerCase())}` : ''}</span></div>
    <div class="mission-line"><span class="k">Progress</span><span class="v big">${m.progress}%</span><div class="meter"><i style="width:${m.progress}%"></i></div></div>
    <div class="mission-line"><span class="k">Pipeline</span>${stages}</div>
    <div class="mission-line"><span class="k">Agents</span>${agents}</div>`;
}

function renderIntel(products: CandidateView[]): void {
  const body = $('intel-body');
  const ordered = [...products].sort((a, b) => {
    const rank = (c: CandidateView) => (c.stage === 'VALIDATED' ? 0 : c.stage === 'REJECTED' ? 2 : 1);
    return rank(a) - rank(b) || (b.score?.total ?? -1) - (a.score?.total ?? -1);
  });
  $('intel-count').textContent = String(products.length);
  if (!ordered.length) {
    body.innerHTML = '<p class="empty">Discoveries appear here as JARVIS finds them, with the evidence behind each one.</p>';
    renderedCandidates.clear();
    return;
  }

  const html = ordered
    .map((c) => {
      const base = c.economics?.scenarios.find((x) => x.label === 'BASE');
      const cur = c.economics?.currency ?? '';
      const cls = c.stage === 'REJECTED' ? 'rejected' : c.stage === 'VALIDATED' ? 'validated' : '';
      const fresh = renderedCandidates.get(c.id) !== fingerprint(c) ? 'enter' : '';
      const sources = c.evidence
        .filter((e) => e.source)
        .slice(0, 5)
        .map((e) => `<a href="${escape(e.source?.url ?? '')}" target="_blank" rel="noopener noreferrer" title="${escape(e.claim)}">${escape(hostOf(e.source?.url ?? ''))}</a>`)
        .join('');
      return `
      <article class="disc ${cls} ${fresh}">
        <h4>${escape(c.name)}</h4>
        <div class="grid">
          <div class="cell"><span class="k">Score</span><span class="v">${c.score?.total ?? '—'}</span></div>
          <div class="cell"><span class="k">Margin</span><span class="v">${base ? `${cur}${base.contributionBeforeAds}` : '—'}</span></div>
          <div class="cell"><span class="k">BE CPA</span><span class="v">${base ? `${cur}${base.breakEvenCpa}` : '—'}</span></div>
          <div class="cell"><span class="k">Conf</span><span class="v">${(c.score?.confidence ?? '—').slice(0, 3)}</span></div>
        </div>
        <p class="why ${c.rejection ? 'reject' : ''}">${escape(c.rejection ? c.rejection.reason : c.description ?? 'Under investigation.')}</p>
        <p class="why">
          ${chipFor('trend', c.trend?.momentum.value, c.trend?.momentum.provenance)}
          ${chipFor('saturation', c.competition?.saturation.value, c.competition?.saturation.provenance)}
          ${c.economics ? `<span class="prov ${c.economics.fullyGrounded ? 'FACT' : 'ASSUMPTION'}">${c.economics.fullyGrounded ? 'grounded costs' : 'assumed inputs'}</span>` : `<span class="prov UNKNOWN">no costs</span>`}
          <span class="prov ${c.score ? 'INFERENCE' : 'UNKNOWN'}">${c.score ? `${Math.round(c.score.coverage * 100)}% covered` : 'unscored'}</span>
        </p>
        ${sources ? `<div class="src">${sources}</div>` : '<p class="why"><span class="prov UNKNOWN">no sources retrieved</span></p>'}
      </article>`;
    })
    .join('');

  body.innerHTML = html;
  renderedCandidates = new Map(ordered.map((c) => [c.id, fingerprint(c)]));
}

function chipFor(label: string, value: string | null | undefined, provenance: string | undefined): string {
  if (!value) return `<span class="prov UNKNOWN">${label}: unknown</span>`;
  return `<span class="prov ${escape(provenance ?? 'UNKNOWN')}">${label}: ${escape(value.toLowerCase())}</span>`;
}

function fingerprint(c: CandidateView): string {
  return `${c.stage}|${c.score?.total ?? ''}|${c.evidence.length}|${c.rejection?.reason ?? ''}`;
}

/* ----------------------------------------------------------- telemetry */

/**
 * The monitor column. Each row is a measurement taken by the server; a metric
 * the host cannot report arrives with value null and is drawn as UNKNOWN with
 * no bar, because a bar with nothing behind it would read as a reading.
 */
async function pollTelemetry(): Promise<void> {
  let t: TelemetryView;
  try {
    const res = await fetch('/api/telemetry');
    if (!res.ok) throw new Error(String(res.status));
    t = (await res.json()) as TelemetryView;
  } catch {
    $('sys-uptime').textContent = 'offline';
    return;
  }

  const up = t.uptimeSeconds;
  const h = Math.floor(up / 3600);
  const m = Math.floor((up % 3600) / 60);
  $('sys-uptime').textContent = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(up % 60).padStart(2, '0')}s`;

  const body = $('sys-body');
  for (const metric of t.metrics) {
    let row = body.querySelector<HTMLDivElement>(`[data-metric="${metric.id}"]`);
    if (!row) {
      row = document.createElement('div');
      row.dataset['metric'] = metric.id;
      row.innerHTML = '<span class="k"></span><span class="v"></span><span class="bar"><i></i></span>';
      body.appendChild(row);
    }
    const unknown = metric.value === null;
    row.className = `sys-row${unknown ? ' unknown' : metric.tone === 'normal' ? '' : ` ${metric.tone}`}`;
    (row.querySelector('.k') as HTMLElement).textContent = metric.label;
    const v = row.querySelector('.v') as HTMLElement;
    v.textContent = unknown ? metric.display.split(' — ')[0] ?? 'UNKNOWN' : metric.display;
    v.className = `v${unknown ? ' unknown' : ''}`;
    v.title = metric.display;
    (row.querySelector('.bar i') as HTMLElement).style.width = metric.fraction === null ? '0' : `${Math.round(metric.fraction * 100)}%`;
    (row.querySelector('.bar') as HTMLElement).style.visibility = metric.fraction === null ? 'hidden' : 'visible';
  }
}

/* --------------------------------------------------------- status pill */

const pill = $('status-pill');
const pillLabel = $('pill-label');
const pillCanvas = $<HTMLCanvasElement>('pill-wave');
const pillCtx = pillCanvas.getContext('2d');

/** An override (listening, speaking) that outranks the mission-derived word. */
let pillOverride: string | null = null;

function setPill(override: string | null): void {
  pillOverride = override;
  paintPillLabel();
}

function paintPillLabel(): void {
  const word = pillOverride ?? core.state.toLowerCase();
  pillLabel.textContent = word;
  pill.dataset['live'] = String(pillOverride !== null || !['standby', 'complete', 'paused'].includes(word));
}

/**
 * The trace is the orb's own activity envelope — the same numbers that drive
 * the core — so the pill cannot show movement the system is not making.
 */
function paintPill(): void {
  if (!pillCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = pillCanvas.clientWidth;
  const h = pillCanvas.clientHeight;
  if (pillCanvas.width !== Math.round(w * dpr)) {
    pillCanvas.width = Math.round(w * dpr);
    pillCanvas.height = Math.round(h * dpr);
  }
  pillCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pillCtx.clearRect(0, 0, w, h);

  const wave = core.wave;
  const mid = h / 2;
  pillCtx.strokeStyle = pillOverride !== null ? '#f2a63b' : '#5ee6dc';
  pillCtx.lineWidth = 1;
  pillCtx.beginPath();
  for (let i = 0; i < wave.length; i += 1) {
    const x = (i / (wave.length - 1)) * w;
    const a = (wave[i] ?? 0) * (mid - 1);
    pillCtx.moveTo(x, mid - a);
    pillCtx.lineTo(x, mid + a);
  }
  pillCtx.stroke();
  pillCtx.globalAlpha = 0.3;
  pillCtx.beginPath();
  pillCtx.moveTo(0, mid);
  pillCtx.lineTo(w, mid);
  pillCtx.stroke();
  pillCtx.globalAlpha = 1;
  requestAnimationFrame(paintPill);
}
requestAnimationFrame(paintPill);

/* -------------------------------------------------------------- events */

const MAX_TIMELINE = 160;
let eventCount = 0;

function pushEvent(e: EventView): void {
  if (seenEvents.has(e.id)) return;
  seenEvents.add(e.id);
  if (seenEvents.size > 900) seenEvents = new Set([...seenEvents].slice(-500));

  eventCount += 1;
  $('ev-count').textContent = String(eventCount);
  const magnitude = e.kind === 'discovery' ? 1 : e.kind === 'rejection' ? 0.75 : 0.42;
  core.pulse(magnitude);
  restOrb.pulse(magnitude);
  workOrb.pulse(magnitude);

  const row = document.createElement('div');
  row.className = `ev ${e.level === 'warn' ? 'warn' : e.level === 'error' ? 'error' : e.kind} enter`;
  row.innerHTML = `<span class="t">${time(e.at)}</span><span class="a">${escape(e.agent ?? e.kind)}</span><span class="m">${escape(e.message)}</span>`;
  const body = $('timeline-body');
  body.appendChild(row);
  // Cap the DOM: an all-day mission must not grow an unbounded list.
  while (body.childElementCount > MAX_TIMELINE) body.removeChild(body.firstChild as Node);
  body.scrollTop = body.scrollHeight;

  if (e.target?.url || e.target?.action) {
    $('core-action').textContent = e.message;
    $('core-target').textContent = e.target.url ?? e.target.site ?? '';
    setTakeoverLine(e.message, e.target.url ?? e.target.site ?? '');
    // Anything the browser agent actually captured becomes the backdrop, so the
    // operator sees the page JARVIS is on rather than a stock graphic.
    const shot = typeof e.data?.['screenshot'] === 'string' ? (e.data['screenshot'] as string) : null;
    if (shot) showVision(shot);
  } else if (e.kind === 'mission' || e.kind === 'agent') {
    $('core-action').textContent = e.message;
    setTakeoverLine(e.message, '');
  }
  $('core-state').textContent = core.state.toLowerCase();
  paintPillLabel();

  if (['mission', 'discovery', 'rejection', 'permission', 'adapter', 'evidence', 'economics'].includes(e.kind)) scheduleRefresh();
}

/** One line: what JARVIS is doing, and where. Nothing else competes with it. */
function setTakeoverLine(action: string, target: string): void {
  $('takeover-action').textContent = action;
  $('takeover-target').textContent = target;
}

/**
 * A screenshot the browser agent actually captured becomes the working view.
 * Until one exists the frame stays empty and says so, because an interface that
 * shows a stock graphic where the machine's screen should be is claiming to be
 * driving something it is not.
 */
function showVision(path: string): void {
  for (const id of ['vision', 'rest-vision']) {
    const el = $(id);
    el.style.backgroundImage = `url("${path}")`;
    el.classList.add('on');
  }
  const view = $('takeover-view');
  view.style.backgroundImage = `url("${path}")`;
  view.classList.add('on');
  $('takeover').classList.add('has-view');
  $('takeover').classList.remove('no-view');
}
// Until a capture arrives there is nothing to show, and the view says so.
$('takeover').classList.add('no-view');

function time(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

setInterval(() => {
  if (missionStart === null) return;
  const s = Math.floor((Date.now() - missionStart) / 1000);
  $('s-elapsed').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}, 1000);

/* ------------------------------------------------------------- command */

const voiceSupport = detect();

// The API being present is not the same as the microphone being usable, so
// the status line stays non-committal until the browser has been asked.
$('voice-state').textContent = voiceSupport.recognition ? 'voice: checking' : 'voice: unavailable';
$('voice-state').title = voiceSupport.detail;
void confirmMicrophone().then(({ usable, detail }) => {
  $('voice-state').textContent = usable ? 'voice: ready' : 'voice: blocked';
  $('voice-state').title = detail;
  if (!usable) {
    const mic = $('mic') as HTMLButtonElement;
    mic.disabled = true;
    mic.title = detail;
    $('rest-hint').textContent = 'press any key to type';
    return;
  }
  // Listening starts only once the browser has confirmed the microphone, so the
  // interface never claims to be listening when it cannot.
  wake.start();
});

const voice = new Voice(
  (text, final) => {
    ($('utterance') as HTMLInputElement).value = text;
    if (final) void send(text);
  },
  (listening) => {
    $('mic').setAttribute('aria-pressed', String(listening));
    $('mic').textContent = listening ? 'LISTENING…' : 'MICROPHONE';
    setPill(listening ? 'listening' : null);
  },
);

/*
 * Browsers refuse to speak until the page has been interacted with, and they
 * refuse without saying so. Spend the very first gesture — whatever it is —
 * on unlocking the voice, so the first reply JARVIS gives is actually heard.
 */
for (const event of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(event, () => voice.prime(), { once: true, capture: true });
}

/*
 * The system listens for its own name from the moment it is allowed to. Saying
 * "Jarvis" wakes it; whatever follows in the same breath is the command. Until
 * the name is heard nothing leaves the page.
 */
const wake = new WakeListener(
  () => {
    setPill('listening');
    restOrb.pulse(1);
    workOrb.pulse(1);
    $('rest-hint').textContent = 'listening';
  },
  (command) => {
    setPill(null);
    $('rest-hint').textContent = HINT;
    void send(command);
  },
  (heard) => {
    // Shows that it is genuinely hearing, without sending anything anywhere.
    if (view === 'rest') $('rest-hint').textContent = heard.slice(-70);
  },
  (reason) => {
    $('voice-state').textContent = 'voice: blocked';
    $('voice-state').title = reason;
    $('rest-hint').textContent = reason;
  },
);

const HINT = 'say \u201cJarvis\u201d, or press any key to type';
$('rest-hint').textContent = wake.available ? HINT : 'press any key to type';

voice.onSpeaking = (speaking) => {
  setPill(speaking ? 'speaking' : null);
  // A listener left running hears the reply and answers itself.
  if (speaking) wake.stop();
  else if (wake.available) wake.start();
};
// A microphone that fails silently reads as a broken system. Whatever the
// browser reports is shown where the operator is already looking.
voice.onProblem = (reason) => {
  $('reply').textContent = reason;
  $('voice-state').textContent = 'voice: blocked';
  $('voice-state').title = reason;
};
if (!voice.available) ($('mic') as HTMLButtonElement).disabled = true;

/** Shows what JARVIS said, then lets it fade rather than leaving text sitting. */
let sayTimer = 0;
function showSpoken(text: string): void {
  const el = $('takeover-reply');
  el.textContent = text;
  el.classList.add('on');
  window.clearTimeout(sayTimer);
  sayTimer = window.setTimeout(() => el.classList.remove('on'), Math.max(4000, text.length * 70));
}

/*
 * A storefront JARVIS built is put on screen as the storefront. Showing it in
 * place is the difference between reporting work and handing over the result.
 */
function showSite(url: string): void {
  const wrap = $('takeover-site');
  const frame = $('takeover-site-frame') as HTMLIFrameElement;
  const open = $('takeover-site-open') as HTMLAnchorElement;
  frame.src = url;
  open.href = url;
  wrap.hidden = false;
  setView('takeover');
}

function hideSite(): void {
  const wrap = $('takeover-site');
  wrap.hidden = true;
  ($('takeover-site-frame') as HTMLIFrameElement).src = 'about:blank';
}

async function send(utterance: string): Promise<void> {
  const text = utterance.trim();
  if (!text) return;
  for (const id of ['utterance', 'takeover-utterance', 'rest-utterance']) ($(id) as HTMLInputElement).value = '';
  $('takeover').classList.remove('typing');
  $('reply').textContent = '…';
  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ utterance: text }),
    });
    const reply = (await res.json()) as { speech: string; view?: 'detail' | 'plain' | 'input'; site?: string };
    $('reply').textContent = reply.speech;
    showSpoken(reply.speech);
    // What the operator asked to see, they see.
    if (reply.view === 'detail') setView('detail');
    else if (reply.view === 'plain') setView(working ? 'takeover' : 'rest');
    else if (reply.view === 'input') {
      if (view === 'rest') $('rest-utterance').focus();
      else openTyping();
    }
    if (reply.site) showSite(reply.site);
    if (voiceSupport.synthesis) voice.say(reply.speech);
    scheduleRefresh();
  } catch (err) {
    const message = `Command failed: ${(err as Error).message}`;
    $('reply').textContent = message;
    showSpoken(message);
  }
}

/*
 * Reaching the system must never depend on the microphone. In the working view
 * any typed character, or a tap, brings the field up — the same thing saying
 * "Jarvis, let me type" does.
 */
const takeoverInput = $('takeover-utterance') as HTMLInputElement;
takeoverInput.addEventListener('keydown', (e) => {
  const key = e as KeyboardEvent;
  if (key.key === 'Enter' && takeoverInput.value.trim()) void send(takeoverInput.value);
  if (key.key === 'Escape') {
    // Dismissing the keyboard must not halt the work: escape from the field is
    // a retreat from typing, not an interrupt.
    key.stopPropagation();
    takeoverInput.value = '';
    $('takeover').classList.remove('typing');
    takeoverInput.blur();
  }
});
takeoverInput.addEventListener('blur', closeTyping);
$('takeover').addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  // The typing field and the storefront panel own their own clicks.
  if (el.closest('#takeover-input-wrap') || el.closest('#takeover-site')) return;
  openTyping();
});
$('takeover-site-close').addEventListener('click', hideSite);
window.addEventListener('keydown', (e) => {
  const key = e as KeyboardEvent;
  if (view !== 'takeover') return;
  if (key.metaKey || key.ctrlKey || key.altKey) return;
  const target = key.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
  if (key.key.length !== 1 && key.key !== '/') return;
  if (!$('takeover-site').hidden && key.key !== '/') return;
  openTyping();
  if (key.key !== '/') takeoverInput.value = key.key;
  key.preventDefault();
});

const restInput = $('rest-utterance') as HTMLInputElement;
restInput.addEventListener('input', () => {
  $('rest').classList.toggle('typing', restInput.value.length > 0);
});
restInput.addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter' && restInput.value.trim()) {
    const text = restInput.value;
    restInput.value = '';
    $('rest').classList.remove('typing');
    enterWork();
    void send(text);
  }
});
// A click anywhere at rest puts the cursor where the operator expects it.
$('rest').addEventListener('click', () => restInput.focus());

$('send').addEventListener('click', () => void send(($('utterance') as HTMLInputElement).value));
$('utterance').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') void send(($('utterance') as HTMLInputElement).value);
});
$('mic').addEventListener('click', () => {
  // Push-to-talk and the wake listener cannot hold the microphone at once.
  if (!voice.listening) wake.stop();
  else if (wake.available) wake.start();
  voice.toggle();
});

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-control]')) {
  btn.addEventListener('click', async () => {
    const control = btn.dataset['control'];
    // Stop must feel instantaneous: silence speech before the request lands.
    if (control === 'STOP') voice.silence();
    await fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ control }) });
    $('reply').textContent = control === 'STOP' ? 'Stopping. State is preserved.' : control === 'PAUSE' ? 'Paused.' : 'Resuming.';
    scheduleRefresh();
  });
}
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-say]')) {
  btn.addEventListener('click', () => void send(btn.dataset['say'] ?? ''));
}

$('perm-btn').addEventListener('click', async () => {
  const input = window.prompt('Permission level 0-6.\n0 research only · 1 local files · 2 Shopify drafts · 3 supplier drafts · 4 campaign prep · 5 ad launch · 6 financial.\nLevel 5+ still needs a separate spending authorisation.');
  if (input === null) return;
  const level = Number(input.trim());
  if (!Number.isInteger(level) || level < 0 || level > 6) {
    $('reply').textContent = 'Permission levels run from 0 to 6.';
    return;
  }
  await fetch('/api/permission', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level, note: 'Set from the command center.' }) });
  scheduleRefresh();
});

/* --------------------------------------------------------- preferences */

$('t-motion').addEventListener('click', () => {
  const off = root.dataset['motion'] === 'off';
  root.dataset['motion'] = off ? 'on' : 'off';
  $('t-motion').setAttribute('aria-pressed', String(off));
  core.setStill(!off);
  restOrb.setStill(!off);
  field.setStill(!off);
});
if (prefersStill) $('t-motion').setAttribute('aria-pressed', 'false');

$('t-contrast').addEventListener('click', () => {
  const high = root.dataset['contrast'] === 'high';
  root.dataset['contrast'] = high ? 'normal' : 'high';
  $('t-contrast').setAttribute('aria-pressed', String(!high));
});

/** Shutdown: modules retract, the core contracts, everything fades to black. */
$('t-shutdown').addEventListener('click', () => {
  voice.silence();
  const shell = $('shell');
  shell.style.transition = 'opacity 900ms ease, transform 900ms cubic-bezier(0.7, 0, 0.84, 0)';
  shell.style.transformOrigin = 'center';
  shell.style.transform = 'scale(0.92)';
  shell.style.opacity = '0';
  core.state = 'STANDBY';
  restOrb.state = 'STANDBY';
  setTimeout(() => {
    shell.style.transform = '';
    shell.style.opacity = '';
    enterRest();
  }, 950);
});

/* Keyboard: the whole system is operable without a pointer. */
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== $('utterance') && document.activeElement !== restInput) {
    e.preventDefault();
    if (view === 'takeover') openTyping();
    else (view === 'detail' ? $('utterance') : restInput).focus();
  }
  if (e.key === 'Escape') {
    // The typing field owns escape while it is open; only otherwise does escape
    // mean interrupt.
    if ($('takeover').classList.contains('typing')) return;
    voice.silence();
    void fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ control: 'STOP' }) });
    $('reply').textContent = 'Stopping. State is preserved.';
  }
});

/* ------------------------------------------------------------- helpers */

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

setInterval(() => void refresh(), 12000);
// Telemetry is polled rather than pushed: it is a measurement of this moment,
// and a stale reading on screen would be worse than a slightly slower one.
setInterval(() => void pollTelemetry(), 4000);
void pollTelemetry();
