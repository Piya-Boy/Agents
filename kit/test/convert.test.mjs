import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent, convertAgent, copilotTools, isReadOnly, tomlMultiline } from '../convert.mjs';
import { installAgents, loadManifest, resolveProfiles, main } from '../install.mjs';
import { makeTempProject, fakeRunner } from './helpers.mjs';

const kitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = (p) => fs.access(p).then(() => true, () => false);

const readOnlyAgent = `---
name: architect
description: Designs "systems": the big picture.
model: opus
tools: Read, Grep, Glob, Skill
---

You are the architect.
Keep it short.
`;
const researcherAgent = `---
name: researcher
description: Finds the current API.
model: sonnet
tools: Read, Grep, Glob, Skill, WebSearch, WebFetch, mcp__plugin_context7_context7__query-docs
---

Research first.
`;
const builderAgent = `---
name: developer
description: Implements changes.
model: sonnet
---

Build things.
`;

test('parseAgent reads frontmatter and body; rejects bad files', () => {
  const a = parseAgent(readOnlyAgent);
  assert.equal(a.name, 'architect');
  assert.equal(a.model, 'opus');
  assert.deepEqual(a.tools, ['Read', 'Grep', 'Glob', 'Skill']);
  assert.equal(a.body, 'You are the architect.\nKeep it short.\n');
  assert.equal(parseAgent(builderAgent).tools, null);
  assert.equal(parseAgent(readOnlyAgent.replace(/\n/g, '\r\n')).body, a.body);
  assert.throws(() => parseAgent('no frontmatter'), /no frontmatter/);
  assert.throws(() => parseAgent('---\nname: x\n---\nbody'), /name and description/);
});

test('isReadOnly: only when tools are listed and none can write', () => {
  assert.equal(isReadOnly(parseAgent(readOnlyAgent)), true);
  assert.equal(isReadOnly(parseAgent(builderAgent)), false);
  assert.equal(isReadOnly({ tools: ['Read', 'Edit'] }), false);
});

test('codex: TOML file with the body as developer_instructions, no model or tools', () => {
  const out = convertAgent('codex', parseAgent(readOnlyAgent));
  assert.equal(out.path, '.codex/agents/architect.toml');
  assert.match(out.content, /^name = "architect"\ndescription = "Designs \\"systems\\": the big picture\."\ndeveloper_instructions = '''\n/);
  assert.ok(out.content.includes('This agent is read-only.'));
  assert.ok(out.content.includes('You are the architect.\nKeep it short.\n'));
  assert.ok(out.content.endsWith("'''\n"));
  assert.ok(!/model|tools/.test(out.content.split("developer_instructions")[0]));
  const dev = convertAgent('codex', parseAgent(builderAgent));
  assert.ok(!dev.content.includes('read-only'));
});

test('tomlMultiline: literal string, with a safe fallback when the text has three quotes', () => {
  assert.equal(tomlMultiline('a\nb\n'), "'''\na\nb\n'''");
  const t = tomlMultiline("it's '''odd''' \\ and \"\"\"q\"\"\"\n");
  assert.ok(t.startsWith('"""\n'));
  assert.ok(!t.slice(4, -3).includes('"""'));
  assert.ok(t.includes('\\\\'));
});

test('cursor: readonly flag for read-only agents, model inherit, no tools', () => {
  const ro = convertAgent('cursor', parseAgent(readOnlyAgent));
  assert.equal(ro.path, '.cursor/agents/architect.md');
  assert.match(ro.content, /^---\nname: architect\ndescription: "Designs \\"systems\\": the big picture\."\nmodel: inherit\nreadonly: true\n---\n\nYou are the architect\./);
  const dev = convertAgent('cursor', parseAgent(builderAgent));
  assert.ok(!dev.content.includes('readonly'));
  assert.ok(!/^tools:/m.test(ro.content));
});

test('gemini: no tools field, model inherit, read-only note in the body', () => {
  const ro = convertAgent('gemini', parseAgent(readOnlyAgent));
  assert.equal(ro.path, '.gemini/agents/architect.md');
  assert.ok(!/^tools:/m.test(ro.content));
  assert.match(ro.content, /model: inherit\n---\n\nThis agent is read-only\./);
  const dev = convertAgent('gemini', parseAgent(builderAgent));
  assert.ok(!dev.content.includes('read-only'));
});

test('copilot: tools mapped to aliases; left out (with a note) when a tool cannot be mapped', () => {
  assert.deepEqual(copilotTools(parseAgent(readOnlyAgent)), ['read', 'search']);
  assert.deepEqual(copilotTools({ tools: ['Read', 'Grep', 'Glob', 'Bash', 'Skill'] }), ['read', 'search', 'execute']);
  assert.equal(copilotTools(parseAgent(researcherAgent)), null);
  assert.equal(copilotTools(parseAgent(builderAgent)), null);
  const ro = convertAgent('copilot', parseAgent(readOnlyAgent));
  assert.equal(ro.path, '.github/agents/architect.agent.md');
  assert.match(ro.content, /tools: \["read", "search"\]/);
  assert.ok(!ro.content.includes('read-only'), 'restricted by tools, so no note');
  const re = convertAgent('copilot', parseAgent(researcherAgent));
  assert.ok(!/^tools:/m.test(re.content));
  assert.ok(re.content.includes('This agent is read-only.'), 'unrestricted, so the note carries it');
  const dev = convertAgent('copilot', parseAgent(builderAgent));
  assert.ok(!dev.content.includes('read-only') && !/^tools:/m.test(dev.content));
});

test('convertAgent returns null for claude and unknown tools', () => {
  assert.equal(convertAgent('claude', parseAgent(builderAgent)), null);
  assert.equal(convertAgent('vim', parseAgent(builderAgent)), null);
});

async function agentsCtx(dir, tools, opts = {}) {
  const manifest = await loadManifest(kitDir);
  return {
    kitDir,
    projectDir: dir,
    manifest,
    profile: resolveProfiles(manifest, [opts.profile ?? 'core']),
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
    opts: { dryRun: opts.dryRun ?? false, tools },
    log() {},
  };
}

test('every real kit agent converts for every tool', async () => {
  const manifest = await loadManifest(kitDir);
  const profile = resolveProfiles(manifest, ['web']);
  let n = 0;
  for (const dir of profile.agentDirs) {
    for (const f of (await fs.readdir(path.join(kitDir, dir))).filter((x) => x.endsWith('.md'))) {
      const agent = parseAgent(await fs.readFile(path.join(kitDir, dir, f), 'utf8'));
      assert.equal(`${agent.name}.md`, f, 'file name matches the agent name');
      for (const tool of ['codex', 'cursor', 'gemini', 'copilot']) {
        const out = convertAgent(tool, agent);
        assert.ok(out.content.includes(agent.body.trim().split('\n')[0]), `${tool}:${f} keeps the body`);
        assert.match(path.basename(out.path), /^[a-z0-9-]+\.(toml|md|agent\.md)$/);
      }
      n++;
    }
  }
  assert.equal(n, 13);
});

test('installAgents: codex only writes 10 TOML files and nothing under .claude', async () => {
  const dir = await makeTempProject();
  const res = await installAgents(await agentsCtx(dir, ['codex']));
  assert.equal(res.length, 10);
  assert.ok(res.every((r) => r.status === 'installed' && r.item.startsWith('.codex/agents/')));
  assert.equal(await exists(path.join(dir, '.claude')), false);
  const toml = await fs.readFile(path.join(dir, '.codex/agents/reviewer.toml'), 'utf8');
  assert.match(toml, /developer_instructions = '''/);
});

test('installAgents: web profile adds the three web agents per tool', async () => {
  const dir = await makeTempProject();
  const res = await installAgents(await agentsCtx(dir, ['gemini', 'copilot'], { profile: 'web' }));
  assert.equal(res.length, 26);
  assert.equal(await exists(path.join(dir, '.gemini/agents/web-dev.md')), true);
  assert.equal(await exists(path.join(dir, '.github/agents/designer.agent.md')), true);
});

test('installAgents: claude and cursor together write .claude/agents once and skip a Cursor copy', async () => {
  const dir = await makeTempProject();
  const res = await installAgents(await agentsCtx(dir, ['claude', 'cursor']));
  assert.equal(res.filter((r) => r.status === 'installed').length, 10);
  const cursor = res.find((r) => r.item === 'cursor');
  assert.equal(cursor.status, 'skipped');
  assert.match(cursor.detail, /\.claude\/agents/);
  assert.equal(await exists(path.join(dir, '.cursor')), false);
});

test('installAgents: cursor alone writes .cursor/agents', async () => {
  const dir = await makeTempProject();
  await installAgents(await agentsCtx(dir, ['cursor']));
  assert.equal(await exists(path.join(dir, '.cursor/agents/qa.md')), true);
});

test('installAgents: an existing agent file is left untouched; dry-run writes nothing', async () => {
  const dir = await makeTempProject();
  await fs.mkdir(path.join(dir, '.codex/agents'), { recursive: true });
  await fs.writeFile(path.join(dir, '.codex/agents/qa.toml'), 'MINE');
  const res = await installAgents(await agentsCtx(dir, ['codex']));
  assert.equal(await fs.readFile(path.join(dir, '.codex/agents/qa.toml'), 'utf8'), 'MINE');
  const qa = res.find((r) => r.item === '.codex/agents/qa.toml');
  assert.equal(qa.status, 'skipped');
  const dir2 = await makeTempProject();
  const dry = await installAgents(await agentsCtx(dir2, ['copilot'], { dryRun: true }));
  assert.ok(dry.every((r) => r.status === 'dry-run'));
  assert.deepEqual(await fs.readdir(dir2), []);
});

test('installAgents: default tools still copy the Claude files byte for byte', async () => {
  const dir = await makeTempProject();
  await installAgents(await agentsCtx(dir, undefined));
  const src = await fs.readFile(path.join(kitDir, 'agents/core/qa.md'), 'utf8');
  assert.equal(await fs.readFile(path.join(dir, '.claude/agents/qa.md'), 'utf8'), src);
});

test('main --tool all --only agents: every tool gets its agents without the claude CLI being spawned for them', async () => {
  const dir = await makeTempProject();
  const code = await main(['--tool', 'codex,gemini,copilot', '--only', 'agents'], {
    projectDir: dir, env: { nodeVersion: '24.0.0', resolve: (n) => (n === 'claude' ? null : {}) }, log() {}, isTTY: false, run: fakeRunner().run,
  });
  assert.equal(code, 0);
  for (const p of ['.codex/agents/qa.toml', '.gemini/agents/qa.md', '.github/agents/qa.agent.md']) assert.equal(await exists(path.join(dir, p)), true, p);
});
