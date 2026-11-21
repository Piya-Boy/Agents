import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseCheckOutput, formatNotice, shouldRun, checkSkills } from '../hooks/check-skills.mjs';

const ESC = String.fromCharCode(27);
const sample = [
  'Checking for skill updates...',
  'Fetching 5 sources...',
  ESC + '[33m↑ strategic-compact has an update' + ESC + '[0m',
  '↑ tdd has an update',
  '27 project skill(s) already up to date',
  '2 skill(s) can be updated; run npx skills update to install',
].join('\n');

test('parseCheckOutput finds skills with an update and strips ANSI', () => {
  assert.deepEqual(parseCheckOutput(sample), ['strategic-compact', 'tdd']);
  assert.deepEqual(parseCheckOutput('All project skills are up to date'), []);
  assert.deepEqual(parseCheckOutput(''), []);
});

test('formatNotice', () => {
  assert.equal(formatNotice([]), null);
  const m = formatNotice(['a', 'b']);
  assert.match(m, /a, b/);
  assert.match(m, /npx skills update -p -y/);
});

test('shouldRun throttles by interval and tolerates bad state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hook-'));
  const f = path.join(dir, 'state.json');
  const now = 1_000_000_000;
  assert.equal(await shouldRun(f, now, 1000), true);
  await fs.writeFile(f, JSON.stringify({ lastCheck: now - 500 }));
  assert.equal(await shouldRun(f, now, 1000), false);
  await fs.writeFile(f, JSON.stringify({ lastCheck: now - 5000 }));
  assert.equal(await shouldRun(f, now, 1000), true);
  await fs.writeFile(f, '{bad');
  assert.equal(await shouldRun(f, now, 1000), true);
});

const baseDeps = async (over = {}) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hookp-'));
  return {
    projectDir: dir,
    cli: 'skills@1.9.0',
    stateFile: path.join(dir, 'state.json'),
    intervalMs: 1000,
    now: () => 5_000_000,
    runCheck: async () => ({ code: 1, stdout: sample, stderr: '' }),
    ...over,
  };
};

test('checkSkills: updates -> notice and state saved; second call is throttled', async () => {
  const deps = await baseDeps();
  await fs.writeFile(path.join(deps.projectDir, 'skills-lock.json'), '{}');
  const out = await checkSkills(deps);
  assert.match(out.message, /strategic-compact, tdd/);
  const state = JSON.parse(await fs.readFile(deps.stateFile, 'utf8'));
  assert.equal(state.lastCheck, 5_000_000);
  let ran = 0;
  const again = await checkSkills({ ...deps, runCheck: async () => (ran++, { code: 0, stdout: '', stderr: '' }) });
  assert.equal(again.message, null);
  assert.equal(ran, 0);
});

test('checkSkills: up to date, no lock, or failing check -> silent', async () => {
  const d1 = await baseDeps({ runCheck: async () => ({ code: 0, stdout: 'All project skills are up to date', stderr: '' }) });
  await fs.writeFile(path.join(d1.projectDir, 'skills-lock.json'), '{}');
  assert.equal((await checkSkills(d1)).message, null);
  const d2 = await baseDeps();
  assert.equal((await checkSkills(d2)).message, null);
  const d3 = await baseDeps({ runCheck: async () => { throw new Error('offline'); } });
  await fs.writeFile(path.join(d3.projectDir, 'skills-lock.json'), '{}');
  assert.equal((await checkSkills(d3)).message, null);
});
