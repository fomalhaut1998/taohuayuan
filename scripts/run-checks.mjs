import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const entries = readdirSync(dir)
  .filter((name) => /^(check|test)-.+\.mjs$/.test(name))
  .sort();

const failures = [];
const started = performance.now();

for (const name of entries) {
  const args = [path.join('scripts', name)];
  if (name === 'check-sampled-audio.mjs') args.push('--assets');
  const t0 = performance.now();
  const res = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ms = Math.round(performance.now() - t0);
  if (res.status === 0) {
    console.log(`PASS ${name} (${ms}ms)`);
  } else {
    console.error(`FAIL ${name} (${ms}ms, exit=${res.status ?? res.signal})`);
    if (res.stdout?.trim()) console.error(res.stdout.trim());
    if (res.stderr?.trim()) console.error(res.stderr.trim());
    failures.push(name);
  }
}

const totalMs = Math.round(performance.now() - started);
console.log(`\nSummary: ${entries.length - failures.length}/${entries.length} passed in ${totalMs}ms`);
if (failures.length) {
  console.error('Failed:', failures.join(', '));
  process.exit(1);
}
