import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import type { JarvisEvent, PermissionLevel } from '../../../core/types/index.ts';
import { PATHS } from '../../../core/util/paths.ts';
import { emit, recent, subscribe, closeLog } from '../../../core/events/bus.ts';
import { followLog, type Tail } from '../../../core/events/tail.ts';
import * as store from '../../../core/state/store.ts';
import * as permissions from '../../../core/permissions/index.ts';
import * as orchestrator from '../../../core/orchestrator/index.ts';
import { probeEnvironment } from '../../../core/environment/probe.ts';
import { research } from '../../../core/research/router.ts';
import { answer as answerBridge, pendingRequests } from '../../../core/research/bridge.ts';
import { respond } from './respond.ts';
import { measure } from '../../../core/telemetry/index.ts';
import { FUNNEL } from '../../../core/orchestrator/pipeline.ts';

/**
 * Command center server.
 *
 * Serves the interface, streams the event log over SSE, and exposes the
 * operator's controls. Credentials never cross this boundary: the client is
 * given adapter *status*, never the values behind it.
 */

const PORT = Number(process.env['JARVIS_PORT'] ?? 7801);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Bound the request body so a stray client cannot exhaust memory.
    if (size > 1_000_000) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function serveStatic(res: http.ServerResponse, urlPath: string): Promise<boolean> {
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  // Screenshots and generated storefronts live outside the web root, each
  // served from its own base so the traversal guard below still applies.
  let base = PATHS.web;
  if (rel.startsWith('screenshots/')) {
    base = path.dirname(PATHS.screenshots);
  } else if (rel === 'site' || rel.startsWith('site/')) {
    base = PATHS.sites;
    rel = rel.slice('site/'.length);
    // A bare /site/<id>/ opens that storefront's home page.
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  }
  const full = path.resolve(base, rel);
  // Path traversal guard: the resolved file must stay inside the served root.
  if (!full.startsWith(path.resolve(base))) {
    res.writeHead(403).end('forbidden');
    return true;
  }
  try {
    const data = await fsp.readFile(full);
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function snapshot() {
  const [mission, products, perms, environment] = await Promise.all([
    orchestrator.currentMission(),
    orchestrator.currentProducts(),
    permissions.current(),
    store.read('environment', null),
  ]);
  return {
    mission,
    products: products.candidates,
    permissions: { ...perms, levels: permissions.LEVELS, capabilities: permissions.CAPABILITIES },
    environment,
    funnel: FUNNEL,
    events: recent(150),
    serverTime: new Date().toISOString(),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const { pathname } = url;

  try {
    if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, await snapshot());

    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(`retry: 2000\n\n`);
      for (const e of recent(60)) res.write(`data: ${JSON.stringify(e)}\n\n`);
      const send = (e: JarvisEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      const unsubscribe = subscribe(send);
      // Keep-alive comment so proxies do not close an idle stream.
      const beat = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(beat);
        unsubscribe();
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/command') {
      const body = await readBody(req);
      const utterance = String(body['utterance'] ?? '').trim();
      if (!utterance) return json(res, 400, { error: 'An utterance is required.' });
      const result = await respond(utterance);
      return json(res, 200, result);
    }

    if (req.method === 'POST' && pathname === '/api/control') {
      const body = await readBody(req);
      const control = String(body['control'] ?? '').toUpperCase();
      if (!['RUN', 'PAUSE', 'STOP'].includes(control)) return json(res, 400, { error: 'control must be RUN, PAUSE or STOP.' });
      const mission = await orchestrator.setControl(control as 'RUN' | 'PAUSE' | 'STOP');
      return json(res, 200, { mission });
    }

    if (req.method === 'POST' && pathname === '/api/permission') {
      const body = await readBody(req);
      const level = Number(body['level']);
      if (!Number.isInteger(level) || level < 0 || level > 6) return json(res, 400, { error: 'level must be an integer from 0 to 6.' });
      const state = await permissions.grant(level as PermissionLevel, 'operator', String(body['note'] ?? 'Set from the command center.'));
      return json(res, 200, { permissions: state });
    }

    if (req.method === 'POST' && pathname === '/api/environment/probe') {
      const report = await probeEnvironment();
      await research.init();
      return json(res, 200, report);
    }

    // The research bridge: the attached Claude session reads pending requests
    // here and posts back what it actually retrieved.
    if (req.method === 'GET' && pathname === '/api/telemetry') return json(res, 200, await measure());

    if (req.method === 'GET' && pathname === '/api/bridge/requests') return json(res, 200, { pending: pendingRequests() });
    if (req.method === 'POST' && pathname === '/api/bridge/answer') {
      const body = await readBody(req);
      const id = String(body['id'] ?? '');
      if (!id) return json(res, 400, { error: 'id is required.' });
      await answerBridge(id, body as never);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && (pathname === '/' || !pathname.startsWith('/api/'))) {
      if (await serveStatic(res, pathname)) return;
      if (await serveStatic(res, '/index.html')) return;
    }

    return json(res, 404, { error: 'not found' });
  } catch (err) {
    emit({ kind: 'error', level: 'error', message: `Request failed: ${(err as Error).message}` });
    return json(res, 500, { error: (err as Error).message });
  }
});

/** Follows the shared log so out-of-process work is visible in the interface. */
let tail: Tail | null = null;

export async function start(): Promise<http.Server> {
  store.ensureStateDir();
  fs.mkdirSync(PATHS.screenshots, { recursive: true });
  await permissions.ensureInitialised();
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  tail = followLog();
  emit({ kind: 'system', message: `Command center listening on port ${PORT}.` });
  // A mission left running by a process that died is nobody's work now.
  await orchestrator.recoverInterrupted();
  // Probe capabilities in the background so the interface can boot immediately.
  void (async () => {
    await probeEnvironment();
    await research.init();
    emit({ kind: 'system', message: 'Capability probe complete. JARVIS is online and ready for command.' });
  })();
  return server;
}

export async function stop(): Promise<void> {
  tail?.stop();
  tail = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await research.close();
  await store.flush();
  await closeLog();
}

// fileURLToPath, not .pathname: on Windows a file: URL's pathname is `/C:/…`,
// which never matches a real path, and the server would silently never start.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  await start();
  const shutdown = async () => {
    emit({ kind: 'system', message: 'Shutting down.' });
    await stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
