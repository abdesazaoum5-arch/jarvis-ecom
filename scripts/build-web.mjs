import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Compiles the command center's TypeScript to ES modules the browser loads directly.
 *
 * Two Windows rules are load-bearing here. `npx` is `npx.cmd` there, so spawning
 * it by bare name fails with ENOENT; the compiler is run through this same Node
 * binary instead, which needs no shell and no PATH lookup. And a file: URL's
 * pathname is `/C:/…` on Windows, which is not a usable path — hence
 * fileURLToPath rather than reading .pathname.
 */
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(cwd, 'apps', 'command-center', 'public', 'js');

const require = createRequire(import.meta.url);
let tsc;
try {
  // Resolve the compiler inside the installed package rather than trusting PATH.
  tsc = path.join(path.dirname(require.resolve('typescript')), '..', 'bin', 'tsc');
} catch {
  console.error('TypeScript is not installed. Run `npm install` first.');
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.web.json'], { cwd, stdio: 'inherit' });
const files = fs.existsSync(out) ? fs.readdirSync(out) : [];
console.log(`web build: ${files.length} module(s) -> apps/command-center/public/js`);
