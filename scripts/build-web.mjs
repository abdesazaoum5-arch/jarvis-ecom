import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Compiles the command center's TypeScript to ES modules the browser loads directly. */
const root = path.dirname(new URL(import.meta.url).pathname);
const cwd = path.resolve(root, '..');
const out = path.join(cwd, 'apps', 'command-center', 'public', 'js');

fs.rmSync(out, { recursive: true, force: true });
execFileSync('npx', ['--no-install', 'tsc', '-p', 'tsconfig.web.json'], { cwd, stdio: 'inherit' });
const files = fs.existsSync(out) ? fs.readdirSync(out) : [];
console.log(`web build: ${files.length} module(s) -> apps/command-center/public/js`);
