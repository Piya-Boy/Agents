import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAutoCheck, parseArgs } from '../install.mjs';
import { makeTempProject, fakeRunner } from './helpers.mjs';

const kitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = (dir, dryRun = false) => ({
  kitDir,
  projectDir: dir,
  manifest: { skillsCli: 'skills@1.9.0' },
  profile: { names: ['core'], agentDirs: [], skills: [], bundledSkills: [], mcp: [], plugins: [] },
  run: fakeRunner().run,
  opts: { dryRun },
  log() {},
});
const read = (dir, f) => fs.readFile(path.join(dir, f), 'utf8');
const sessionStartCommands = (settings) =>
  (settings.hooks?.SessionStart || []).flatMap((e) => e.hooks || []).map((h) => h.command);

test('parseArgs --auto-check and the hooks layer name', () => {
  assert.equal(parseArgs([]).autoCheck, false);
  assert.equal(parseArgs(['--auto-check']).autoCheck, true);
  assert.deepEqual(parseArgs(['--only', 'hooks']).only, new Set(['hooks']));
});

test('installs the script and a SessionStart hook into a fresh project', async () => {
  const dir = await makeTempProject();
  const res = await installAutoCheck(ctx(dir));
  assert.ok(res.every((r) => r.layer === 'hooks' && r.status === 'installed'), JSON.stringify(res));
  await fs.access(path.join(dir, '.claude/hooks/check-skills.mjs'));
  const s = JSON.parse(await read(dir, '.claude/settings.json'));
  const cmds = sessionStartCommands(s);
  assert.equal(cmds.length, 1);
  assert.match(cmds[0], /check-skills\.mjs/);
  assert.match(cmds[0], /skills@1\.9\.0/);
});

test('merges into existing settings and keeps everything else', async () => {
  const dir = await makeTempProject();
  await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
  const existing = {
    permissions: { allow: ['Bash(ls)'] },
    hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo mine' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] },
  };
  await fs.writeFile(path.join(dir, '.claude/settings.json'), JSON.stringify(existing, null, 2));
  await installAutoCheck(ctx(dir));
  const s = JSON.parse(await read(dir, '.claude/settings.json'));
  assert.deepEqual(s.permissions, existing.permissions);
  assert.deepEqual(s.hooks.Stop, existing.hooks.Stop);
  const cmds = sessionStartCommands(s);
  assert.ok(cmds.includes('echo mine'));
  assert.equal(cmds.filter((c) => /check-skills\.mjs/.test(c)).length, 1);
});

test('second run is a no-op', async () => {
  const dir = await makeTempProject();
  await installAutoCheck(ctx(dir));
  const before = await read(dir, '.claude/settings.json');
  const res = await installAutoCheck(ctx(dir));
  assert.ok(res.every((r) => r.status === 'skipped'), JSON.stringify(res));
  assert.equal(await read(dir, '.claude/settings.json'), before);
});

test('invalid settings.json is left untouched and reported failed', async () => {
  const dir = await makeTempProject();
  await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
  await fs.writeFile(path.join(dir, '.claude/settings.json'), '{bad');
  const res = await installAutoCheck(ctx(dir));
  assert.equal(res.find((r) => r.item.includes('settings')).status, 'failed');
  assert.equal(await read(dir, '.claude/settings.json'), '{bad');
});

test('BOM in settings.json is tolerated', async () => {
  const dir = await makeTempProject();
  await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
  await fs.writeFile(path.join(dir, '.claude/settings.json'), '﻿{"model":"x"}');
  await installAutoCheck(ctx(dir));
  assert.equal(JSON.parse(await read(dir, '.claude/settings.json')).model, 'x');
});

test('dry-run writes nothing; an existing script is not overwritten', async () => {
  const dir = await makeTempProject();
  const res = await installAutoCheck(ctx(dir, true));
  assert.ok(res.every((r) => r.status === 'dry-run'));
  await assert.rejects(fs.access(path.join(dir, '.claude')));
  const dir2 = await makeTempProject();
  await fs.mkdir(path.join(dir2, '.claude/hooks'), { recursive: true });
  await fs.writeFile(path.join(dir2, '.claude/hooks/check-skills.mjs'), 'MINE');
  const r2 = await installAutoCheck(ctx(dir2));
  assert.equal(await read(dir2, '.claude/hooks/check-skills.mjs'), 'MINE');
  assert.equal(r2.find((r) => r.item === 'check-skills.mjs').status, 'skipped');
});
