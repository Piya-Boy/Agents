import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, resolveProfile, installAgents, installRules, stripProfileBlock, parseArgs, RULES_START, RULES_END } from '../install.mjs';
import { makeTempProject } from './helpers.mjs';

const kitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function ctxFor(profileName, projectDir, opts = {}) {
  const manifest = await loadManifest(kitDir);
  return {
    kitDir,
    projectDir,
    manifest,
    profile: resolveProfile(manifest, profileName),
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
    opts: { profile: profileName, dryRun: false, yes: true, skipUser: false, only: null, ...opts },
    log() {},
  };
}

const exists = (p) => fs.access(p).then(() => true, () => false);

test('installAgents core copies 10, web adds 3', async () => {
  const dir = await makeTempProject('โปรเจกต์ ใหม่');
  const r1 = await installAgents(await ctxFor('core', dir));
  assert.equal(r1.length, 10);
  assert.ok(r1.every((r) => r.layer === 'agents' && r.status === 'installed'));
  assert.equal((await fs.readdir(path.join(dir, '.claude/agents'))).length, 10);
  const dir2 = await makeTempProject();
  await installAgents(await ctxFor('web', dir2));
  assert.equal((await fs.readdir(path.join(dir2, '.claude/agents'))).length, 13);
});

test('installAgents never overwrites an existing agent', async () => {
  const dir = await makeTempProject();
  await fs.mkdir(path.join(dir, '.claude/agents'), { recursive: true });
  await fs.writeFile(path.join(dir, '.claude/agents/qa.md'), 'MINE');
  const res = await installAgents(await ctxFor('core', dir));
  assert.equal(await fs.readFile(path.join(dir, '.claude/agents/qa.md'), 'utf8'), 'MINE');
  const qa = res.find((r) => r.item === 'qa.md');
  assert.equal(qa.status, 'skipped');
  assert.match(qa.detail, /exists/);
});

test('installAgents dry-run writes nothing', async () => {
  const dir = await makeTempProject();
  const res = await installAgents(await ctxFor('core', dir, { dryRun: true }));
  assert.ok(res.every((r) => r.status === 'dry-run'));
  assert.equal(await exists(path.join(dir, '.claude')), false);
});

test('installRules core strips web block, web keeps template', async () => {
  const dir = await makeTempProject();
  const res = await installRules(await ctxFor('core', dir));
  assert.deepEqual(res.map((r) => [r.item, r.status]), [['AGENTS.md', 'installed'], ['CLAUDE.md', 'installed']]);
  const agents = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(!agents.includes('profile:web') && !agents.includes('Profile: web'));
  const tmplClaude = await fs.readFile(path.join(kitDir, 'templates/CLAUDE.md'), 'utf8');
  assert.equal(await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8'), tmplClaude);
  const dir2 = await makeTempProject();
  await installRules(await ctxFor('web', dir2));
  const tmpl = await fs.readFile(path.join(kitDir, 'templates/AGENTS.md'), 'utf8');
  assert.equal(await fs.readFile(path.join(dir2, 'AGENTS.md'), 'utf8'), tmpl);
});

test('installRules leaves existing AGENTS.md untouched and warns', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, 'AGENTS.md'), 'MINE');
  const res = await installRules(await ctxFor('core', dir));
  assert.equal(await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8'), 'MINE');
  const a = res.find((r) => r.item === 'AGENTS.md');
  assert.equal(a.status, 'skipped');
  assert.match(a.detail, /merge/);
  assert.equal(res.find((r) => r.item === 'CLAUDE.md').status, 'installed');
});

test('parseArgs --merge-rules', () => {
  assert.equal(parseArgs([]).mergeRules, false);
  assert.equal(parseArgs(['--merge-rules']).mergeRules, true);
});

test('installRules --merge-rules appends kit rules and keeps existing text', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, 'AGENTS.md'), '# Mine\n\nkeep this');
  const res = await installRules(await ctxFor('core', dir, { mergeRules: true }));
  const text = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(text.startsWith('# Mine\n\nkeep this\n\n' + RULES_START));
  assert.ok(text.trimEnd().endsWith(RULES_END));
  assert.ok(text.includes('## Orchestration'));
  assert.ok(!text.includes('profile:web'));
  assert.equal((text.match(/^# /gm) || []).length, 1);
  const a = res.find((r) => r.item === 'AGENTS.md');
  assert.equal(a.status, 'installed');
  assert.match(a.detail, /added/);
});

test('installRules --merge-rules is idempotent', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, 'AGENTS.md'), 'MINE\n');
  await installRules(await ctxFor('core', dir, { mergeRules: true }));
  const once = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
  const res = await installRules(await ctxFor('core', dir, { mergeRules: true }));
  assert.equal(await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8'), once);
  assert.equal(res.find((r) => r.item === 'AGENTS.md').status, 'skipped');
});

test('installRules --merge-rules dry-run writes nothing', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, 'AGENTS.md'), 'MINE');
  const res = await installRules(await ctxFor('core', dir, { mergeRules: true, dryRun: true }));
  assert.equal(await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8'), 'MINE');
  assert.equal(res.find((r) => r.item === 'AGENTS.md').status, 'dry-run');
});

test('installRules --merge-rules keeps CRLF line endings and the web section for the web profile', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, 'AGENTS.md'), 'MINE\r\n');
  await installRules(await ctxFor('web', dir, { mergeRules: true }));
  const text = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(text.startsWith('MINE\r\n\r\n' + RULES_START + '\r\n'));
  assert.ok(!/\r\r/.test(text) && !/[^\r]\n/.test(text), 'every newline is a single CRLF');
  assert.ok(text.includes('profile:web'));
});

test('installRules --merge-rules creates a missing AGENTS.md as before', async () => {
  const dir = await makeTempProject();
  const res = await installRules(await ctxFor('core', dir, { mergeRules: true }));
  const text = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(!text.includes(RULES_START));
  assert.equal(res.find((r) => r.item === 'AGENTS.md').status, 'installed');
});

test('installRules without the flag points to --merge-rules', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, 'AGENTS.md'), 'MINE');
  const res = await installRules(await ctxFor('core', dir));
  assert.match(res.find((r) => r.item === 'AGENTS.md').detail, /--merge-rules/);
});

test('stripProfileBlock', () => {
  const src = 'a\n<!-- profile:web:start -->\nX\n<!-- profile:web:end -->\nb\n';
  assert.equal(stripProfileBlock(src, 'web'), 'a\nb\n');
  assert.equal(stripProfileBlock('plain\n', 'web'), 'plain\n');
});
