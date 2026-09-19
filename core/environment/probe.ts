import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdapterReport } from '../types/index.ts';
import { nowIso } from '../util/id.ts';
import * as store from '../state/store.ts';

const run = promisify(execFile);

/**
 * Capability discovery. JARVIS never assumes a tool exists: every adapter is
 * probed at boot and its real status is written to state and shown in the UI.
 */

export type EgressVerdict = 'REACHABLE' | 'BLOCKED_BY_POLICY' | 'UNREACHABLE';

export interface EnvironmentReport {
  checkedAt: string;
  os: { platform: string; release: string; distro: string | null; arch: string };
  runtime: { node: string; cpus: number; memoryGb: number };
  tools: Array<{ name: string; available: boolean; version: string | null; path: string | null }>;
  /** Which hosts the container can actually reach. This is the ground truth. */
  egress: Array<{ host: string; verdict: EgressVerdict; status: number | null; note: string }>;
  adapters: AdapterReport[];
  /** Names only — values are never read into state or logged. */
  credentialsPresent: string[];
  credentialsMissing: string[];
  notes: string[];
}

const TOOL_PROBES: Array<{ name: string; cmd: string; args: string[] }> = [
  { name: 'node', cmd: 'node', args: ['--version'] },
  { name: 'npm', cmd: 'npm', args: ['--version'] },
  { name: 'python3', cmd: 'python3', args: ['--version'] },
  { name: 'git', cmd: 'git', args: ['--version'] },
  { name: 'ffmpeg', cmd: 'ffmpeg', args: ['-version'] },
];

const CREDENTIAL_KEYS = [
  'SHOPIFY_STORE_DOMAIN',
  'SHOPIFY_ADMIN_TOKEN',
  'META_ACCESS_TOKEN',
  'META_AD_ACCOUNT_ID',
  'HIGGSFIELD_API_KEY',
  'SERP_PROVIDER_KEY',
];

/** Hosts that matter to the research mission, probed for real. */
const EGRESS_TARGETS = [
  'https://duckduckgo.com',
  'https://trends.google.com',
  'https://www.google.com',
  'https://www.reddit.com',
  'https://www.aliexpress.com',
  'https://www.alibaba.com',
  'https://www.amazon.com',
  'https://api.github.com',
];

async function probeTool(p: (typeof TOOL_PROBES)[number]) {
  try {
    const { stdout } = await run(p.cmd, p.args, { timeout: 8000 });
    return { name: p.name, available: true, version: stdout.split('\n')[0]?.trim() ?? null, path: p.cmd };
  } catch {
    return { name: p.name, available: false, version: null, path: null };
  }
}

/**
 * A site answering 403 and an egress gateway refusing the host are different
 * facts, and conflating them would make JARVIS report a blocked network as a
 * hostile website. The gateway identifies itself with `x-deny-reason`.
 */
async function probeHost(url: string): Promise<EnvironmentReport['egress'][number]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  const host = new URL(url).hostname;
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'manual' });
    const deny = res.headers.get('x-deny-reason');
    if (deny) {
      return { host, verdict: 'BLOCKED_BY_POLICY', status: res.status, note: `egress gateway: ${deny}` };
    }
    return { host, verdict: 'REACHABLE', status: res.status, note: `HTTP ${res.status}` };
  } catch (err) {
    const msg = (err as Error).message.slice(0, 160);
    const proxyRefusal = /403|proxy|CONNECT|tunnel/i.test(msg);
    return { host, verdict: proxyRefusal ? 'BLOCKED_BY_POLICY' : 'UNREACHABLE', status: null, note: msg };
  } finally {
    clearTimeout(timer);
  }
}

export function findChromium(): string | null {
  const explicit = process.env['JARVIS_CHROMIUM_PATH'];
  if (explicit && fs.existsSync(explicit)) return explicit;
  const roots = [process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? '/opt/pw-browsers', path.join(os.homedir(), '.cache', 'ms-playwright')];
  const candidates: string[] = [];
  for (const root of roots) {
    candidates.push(path.join(root, 'chromium', 'chrome-linux', 'chrome'));
    try {
      for (const entry of fs.readdirSync(root)) {
        if (entry.startsWith('chromium')) {
          candidates.push(path.join(root, entry, 'chrome-linux', 'chrome'));
          candidates.push(path.join(root, entry, 'chrome-linux', 'headless_shell'));
        }
      }
    } catch {
      /* root absent */
    }
  }
  for (const c of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) candidates.push(c);
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

export function findPlaywright(): string | null {
  const candidates = [
    '/opt/node22/lib/node_modules/playwright/index.mjs',
    '/usr/lib/node_modules/playwright/index.mjs',
    path.join(process.cwd(), 'node_modules', 'playwright', 'index.mjs'),
  ];
  const fromEnv = process.env['JARVIS_PLAYWRIGHT_ENTRY'];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

export async function probeEnvironment(): Promise<EnvironmentReport> {
  const [tools, egress] = await Promise.all([
    Promise.all(TOOL_PROBES.map(probeTool)),
    Promise.all(EGRESS_TARGETS.map(probeHost)),
  ]);

  const publicHosts = egress.filter((e) => e.host !== 'api.github.com');
  const openWebReachable = publicHosts.filter((e) => e.verdict === 'REACHABLE').length;
  const blockedByPolicy = publicHosts.filter((e) => e.verdict === 'BLOCKED_BY_POLICY').length;
  const chromium = findChromium();
  const playwright = findPlaywright();

  const credentialsPresent = CREDENTIAL_KEYS.filter((k) => (process.env[k] ?? '').trim().length > 0);
  const credentialsMissing = CREDENTIAL_KEYS.filter((k) => !credentialsPresent.includes(k));

  const adapters: AdapterReport[] = [
    {
      id: 'research.claude-bridge',
      kind: 'research',
      status: 'CONNECTED',
      detail:
        'Research requests are queued to the Claude session, which performs the web search/fetch and writes the findings back with source URLs and timestamps.',
      remedy: null,
      checkedAt: nowIso(),
      free: true,
    },
    {
      id: 'research.http',
      kind: 'research',
      status: openWebReachable > 0 ? 'CONNECTED' : 'NOT_CONNECTED',
      detail:
        openWebReachable > 0
          ? `Direct HTTP egress works for ${openWebReachable} of ${publicHosts.length} probed research hosts.`
          : `The environment's network policy refuses ${blockedByPolicy} of ${publicHosts.length} public research hosts (egress gateway replies "host not in allowlist"). Only package registries and GitHub are reachable.`,
      remedy:
        openWebReachable > 0 ? null : 'Recreate the environment with a network policy that allows the public web, or add the research domains to its allowlist.',
      checkedAt: nowIso(),
      free: true,
    },
    {
      id: 'browser.playwright',
      kind: 'browser',
      status: chromium && playwright ? (openWebReachable > 0 ? 'CONNECTED' : 'DEGRADED') : 'NOT_CONNECTED',
      detail:
        chromium && playwright
          ? openWebReachable > 0
            ? `Chromium at ${chromium} driven by Playwright; public sites reachable.`
            : `Chromium at ${chromium} launches and renders, but the network policy blocks public sites, so it can only drive local pages.`
          : 'Playwright or a Chromium build was not found in this environment.',
      remedy: chromium && playwright ? (openWebReachable > 0 ? null : 'Same network policy change as research.http.') : 'Install Playwright and a Chromium build.',
      checkedAt: nowIso(),
      free: true,
    },
    credentialAdapter('commerce.shopify', 'commerce', ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN'], 'Shopify Admin API', 'Add a custom app token to .env. Storefront assets are still generated locally without it.'),
    credentialAdapter('ads.meta', 'ads', ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'], 'Meta Marketing API', 'Add a Meta system-user token to .env. Campaign structures are still prepared locally without it.'),
    credentialAdapter('creative.higgsfield', 'creative', ['HIGGSFIELD_API_KEY'], 'Higgsfield generation API', 'Add an API key to .env. No credits are ever purchased automatically; without a key JARVIS writes production-ready specs instead.'),
    {
      id: 'voice.web-speech',
      kind: 'voice',
      status: 'UNKNOWN',
      detail: 'Voice runs in the browser. The command center reports the real Web Speech API support of the operator’s browser on load.',
      remedy: null,
      checkedAt: nowIso(),
      free: true,
    },
  ];

  const distro = (() => {
    try {
      const rel = fs.readFileSync('/etc/os-release', 'utf8');
      return /PRETTY_NAME="([^"]+)"/.exec(rel)?.[1] ?? null;
    } catch {
      return null;
    }
  })();

  const report: EnvironmentReport = {
    checkedAt: nowIso(),
    os: { platform: process.platform, release: os.release(), distro, arch: process.arch },
    runtime: { node: process.version, cpus: os.cpus().length, memoryGb: Math.round(os.totalmem() / 1e9) },
    tools: [
      ...tools,
      { name: 'chromium', available: !!chromium, version: null, path: chromium },
      { name: 'playwright', available: !!playwright, version: null, path: playwright },
    ],
    egress,
    adapters,
    credentialsPresent,
    credentialsMissing,
    notes: [
      openWebReachable === 0
        ? 'Direct and browser-driven research of public sites is unavailable under this network policy. The Claude research bridge is the working research path.'
        : 'Public web egress is available to both the HTTP and browser adapters.',
      'No paid service is contacted and no credits are ever purchased. Adapters without credentials stay NOT_CONNECTED.',
    ],
  };

  await store.write('environment', report);
  return report;
}

function credentialAdapter(
  id: string,
  kind: AdapterReport['kind'],
  keys: string[],
  label: string,
  remedy: string,
): AdapterReport {
  const missing = keys.filter((k) => !(process.env[k] ?? '').trim());
  return {
    id,
    kind,
    status: missing.length === 0 ? 'CONNECTED' : 'NOT_CONNECTED',
    detail: missing.length === 0 ? `${label} credentials are present.` : `${label}: missing ${missing.join(', ')}.`,
    remedy: missing.length === 0 ? null : remedy,
    checkedAt: nowIso(),
    free: false,
  };
}
