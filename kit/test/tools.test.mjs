import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, preflight, formatSummary, installRules, main, loadManifest, resolveProfiles, TOOLS } from '../install.mjs';
import { makeTempProject, fakeRunner } from './helpers.mjs';

const kitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const okEnv = { nodeVersion: '24.0.0', resolve: () => ({}) };
const noClaudeEnv = { nodeVersion: '24.0.0', resolve: (n) => (n === 'claude' ? null : {}) };
const exists = (p) => fs.access(p).then(() => true, () => false);

async function ctxFor(dir, tools, opts = {}) {
  const manifest = await loadManifest(kitDir);
  return {
    kitDir,
    projectDir: dir,
    manifest,
    profile: resolveProfiles(manifest, ['core']),
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
    opts: { dryRun: false, yes: true, tools, ...opts },
    log() {},
  };
}

test('parseArgs --tool: default, list, all, order, errors', () => {
  assert.deepEqual(parseArgs([]).tools, ['claude']);
  assert.deepEqual(parseArgs(['--tool', 'codex']).tools, ['codex']);
  assert.deepEqual(parseArgs(['--tool', 'gemini,claude']).tools, ['claude', 'gemini']);
  assert.deepEqual(parseArgs(['--tool', 'cursor,cursor']).tools, ['cursor']);
  assert.deepEqual(parseArgs(['--tool', 'all']).tools, TOOLS);
  assert.deepEqual(parseArgs(['--tool', 'all,codex']).tools, TOOLS);
  assert.throws(() => parseArgs(['--tool', 'vim']), /unknown tool vim/);
  assert.throws(() => parseArgs(['--tool']), /needs a name/);
  assert.throws(() => parseArgs(['--tool', ',']), /needs a name/);
});

test('preflight needs the claude CLI only when claude is a selected tool', () => {
  assert.equal(preflight(noClaudeEnv).ok, false);
  assert.equal(preflight(noClaudeEnv, ['claude', 'codex']).ok, false);
  assert.equal(preflight(noClaudeEnv, ['codex']).ok, true);
  const noGit = preflight({ nodeVersion: '24.0.0', resolve: (n) => (n === 'git' ? null : {}) }, ['codex']);
  assert.match(noGit.problems.join(), /git not found/);
});

test('installRules: default writes AGENTS.md and CLAUDE.md only', async () => {
  const dir = await makeTempProject();
  const res = await installRules(await ctxFor(dir, undefined));
  assert.deepEqual(res.map((r) => r.item), ['AGENTS.md', 'CLAUDE.md']);
  assert.equal(await exists(path.join(dir, 'GEMINI.md')), false);
});

test('installRules: codex only writes AGENTS.md and no CLAUDE.md', async () => {
  const dir = await makeTempProject();
  const res = await installRules(await ctxFor(dir, ['codex']));
  assert.deepEqual(res.map((r) => r.item), ['AGENTS.md']);
  assert.equal(await exists(path.join(dir, 'CLAUDE.md')), false);
});

test('installRules: gemini adds GEMINI.md that imports AGENTS.md', async () => {
  const dir = await makeTempProject();
  const res = await installRules(await ctxFor(dir, ['gemini']));
  assert.deepEqual(res.map((r) => [r.item, r.status]), [['AGENTS.md', 'installed'], ['GEMINI.md', 'installed']]);
  const g = await fs.readFile(path.join(dir, 'GEMINI.md'), 'utf8');
  assert.ok(g.startsWith('@AGENTS.md'));
});

test('installRules: all tools writes the three files; an existing GEMINI.md is left alone', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, 'GEMINI.md'), 'MINE');
  const res = await installRules(await ctxFor(dir, [...TOOLS]));
  assert.deepEqual(res.map((r) => r.item), ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
  assert.equal(await fs.readFile(path.join(dir, 'GEMINI.md'), 'utf8'), 'MINE');
  assert.equal(res.find((r) => r.item === 'GEMINI.md').status, 'skipped');
});

test('installRules: --merge-rules still works with other tools', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, 'AGENTS.md'), 'MINE\n');
  const res = await installRules(await ctxFor(dir, ['codex'], { mergeRules: true }));
  assert.equal(res[0].status, 'installed');
  assert.ok((await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8')).startsWith('MINE\n'));
});

test('formatSummary next steps depend on the tools', () => {
  const rows = [{ layer: 'rules', item: 'AGENTS.md', status: 'installed' }];
  const claude = formatSummary(rows);
  assert.match(claude, /1\. Restart Claude Code/);
  assert.match(claude, /3\. Fill the TODO lines/);
  const codex = formatSummary(rows, ['codex']);
  assert.ok(!/Claude Code/.test(codex));
  assert.match(codex, /1\. Fill the TODO lines/);
});

test('main --tool codex: no claude CLI needed, writes only AGENTS.md, others reported as skipped', async () => {
  const dir = await makeTempProject();
  const logs = [];
  const f = fakeRunner();
  const code = await main(['--tool', 'codex', '--yes'], { projectDir: dir, env: noClaudeEnv, log: (l) => logs.push(l), isTTY: false, run: f.run });
  assert.equal(code, 0);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['AGENTS.md']);
  assert.equal(f.calls.length, 0, 'no command is spawned');
  const out = logs.join('\n');
  assert.match(out, /skipped +codex \(not available for codex yet\)/);
  assert.ok(!/Third-party sources/.test(out));
  assert.ok(!/Restart Claude Code/.test(out));
});

test('main --tool claude,codex: claude layers run and codex gets skipped rows', async () => {
  const dir = await makeTempProject();
  const logs = [];
  const code = await main(['--tool', 'claude,codex', '--only', 'agents,rules'], { projectDir: dir, env: okEnv, log: (l) => logs.push(l), isTTY: false, run: fakeRunner().run });
  assert.equal(code, 0);
  assert.equal(await exists(path.join(dir, '.claude/agents/qa.md')), true);
  assert.match(logs.join('\n'), /skipped +codex \(not available for codex yet\)/);
});

test('main --tool codex with --auto-check and plugins: reported as Claude Code only', async () => {
  const dir = await makeTempProject();
  const logs = [];
  const code = await main(['--tool', 'codex', '--profile', 'superpowers', '--auto-check', '--yes'], { projectDir: dir, env: noClaudeEnv, log: (l) => logs.push(l), isTTY: false, run: fakeRunner().run });
  assert.equal(code, 0);
  const out = logs.join('\n');
  assert.match(out, /\[hooks\]\n +skipped +codex \(Claude Code only\)/);
  assert.match(out, /\[plugins\]\n +skipped +codex \(Claude Code only\)/);
  assert.equal(await exists(path.join(dir, '.claude')), false);
});

test('main without --tool is unchanged: the claude CLI is still required', async () => {
  const dir = await makeTempProject();
  const logs = [];
  const code = await main(['--only', 'rules'], { projectDir: dir, env: noClaudeEnv, log: (l) => logs.push(l), isTTY: false, run: fakeRunner().run });
  assert.equal(code, 1);
  assert.match(logs.join('\n'), /claude not found on PATH/);
});
