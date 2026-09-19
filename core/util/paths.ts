import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root, resolved from this file so the CWD never matters. */
export const ROOT = path.resolve(here, '..', '..');

export const PATHS = {
  root: ROOT,
  state: path.join(ROOT, 'jarvis', 'state'),
  logs: path.join(ROOT, 'jarvis', 'logs'),
  data: path.join(ROOT, 'data'),
  memory: path.join(ROOT, 'jarvis', 'memory'),
  web: path.join(ROOT, 'apps', 'command-center', 'public'),
  screenshots: path.join(ROOT, 'jarvis', 'screenshots'),
  artifacts: path.join(ROOT, 'data', 'artifacts'),
} as const;
