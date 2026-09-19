import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Runs the test suite with its state sandboxed.
 *
 * This exists rather than a shell one-liner because `VAR=value command` is not
 * a thing in Windows cmd, and neither is glob expansion — the suite has to run
 * the same way on every machine the system is meant to run on. The sandbox
 * matters on its own terms: without it a test run writes over the operator's
 * live mission state.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = path.join(os.tmpdir(), 'jarvis-test');
fs.rmSync(sandbox, { recursive: true, force: true });

const files = fs
  .readdirSync(path.join(root, 'tests'))
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => path.join('tests', f));

const { status } = spawnSync(process.execPath, ['--test', '--experimental-strip-types', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    JARVIS_LOG_DIR: path.join(sandbox, 'logs'),
    JARVIS_BRIDGE_DIR: path.join(sandbox, 'bridge'),
    JARVIS_STATE_DIR: path.join(sandbox, 'state'),
  },
});
process.exit(status ?? 1);
