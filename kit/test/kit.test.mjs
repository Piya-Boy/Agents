import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, resolveProfile, resolveProfiles } from '../install.mjs';

const kitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('resolveProfile core', async () => {
  const m = await loadManifest(kitDir);
  const p = resolveProfile(m, 'core');
  assert.deepEqual(p.agentDirs, ['agents/core']);
  assert.deepEqual(p.mcp, ['context7']);
  assert.deepEqual(p.plugins, []);
  assert.deepEqual(p.names, ['core']);
});

test('resolveProfiles combines profiles, core always first, no duplicates', async () => {
  const m = await loadManifest(kitDir);
  const a = resolveProfiles(m, ['web', 'superpowers']);
  assert.deepEqual(a.names, ['core', 'web', 'superpowers']);
  assert.deepEqual(a.agentDirs, ['agents/core', 'agents/web']);
  assert.deepEqual(a.plugins, ['ui-ux-pro-max', 'superpowers']);
  const b = resolveProfiles(m, ['superpowers']);
  assert.deepEqual(b.names, ['core', 'superpowers']);
  assert.deepEqual(b.agentDirs, ['agents/core']);
  assert.deepEqual(b.plugins, ['superpowers']);
  const c = resolveProfiles(m, ['web', 'web', 'core']);
  assert.deepEqual(c.names, ['core', 'web']);
  assert.deepEqual(c.mcp, ['context7', 'chrome-devtools']);
  assert.throws(() => resolveProfiles(m, ['nope']), /unknown profile: nope/);
});

test('resolveProfile web extends core', async () => {
  const m = await loadManifest(kitDir);
  const p = resolveProfile(m, 'web');
  assert.deepEqual(p.agentDirs, ['agents/core', 'agents/web']);
  assert.deepEqual(p.mcp, ['context7', 'chrome-devtools']);
  assert.deepEqual(p.plugins, ['ui-ux-pro-max']);
  assert.deepEqual(p.names, ['core', 'web']);
  const last = p.skills[p.skills.length - 1];
  assert.deepEqual(last, { repo: 'GoogleChrome/modern-web-guidance', skills: ['modern-web-guidance'] });
  assert.equal(p.skills[0].repo, 'addyosmani/agent-skills');
});

test('resolveProfile errors', () => {
  assert.throws(() => resolveProfile({ profiles: {} }, 'nope'), /unknown profile: nope/);
  const cyc = { profiles: { a: { extends: 'b' }, b: { extends: 'a' } } };
  assert.throws(() => resolveProfile(cyc, 'a'), /cycle/);
});

test('loadManifest rejects without kit.json', async () => {
  const empty = await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'nokit-'));
  await assert.rejects(loadManifest(empty), /kit\.json/);
});

test('real kit is consistent', async () => {
  const m = await loadManifest(kitDir);
  const core = await fs.readdir(path.join(kitDir, 'agents/core'));
  const web = await fs.readdir(path.join(kitDir, 'agents/web'));
  assert.equal(core.filter((f) => f.endsWith('.md')).length, 10);
  assert.equal(web.filter((f) => f.endsWith('.md')).length, 3);
  for (const f of core.map((f) => 'agents/core/' + f).concat(web.map((f) => 'agents/web/' + f))) {
    const text = await fs.readFile(path.join(kitDir, f), 'utf8');
    assert.ok(text.startsWith('---'), `${f} frontmatter`);
  }
  for (const name of ['core', 'web']) {
    const p = resolveProfile(m, name);
    for (const s of p.bundledSkills) await fs.access(path.join(kitDir, 'skills', s, 'SKILL.md'));
    for (const s of p.mcp) assert.ok(m.mcp[s], `mcp ${s}`);
    for (const s of p.plugins) assert.ok(m.plugins[s], `plugin ${s}`);
  }
  const agents = await fs.readFile(path.join(kitDir, 'templates/AGENTS.md'), 'utf8');
  assert.ok(agents.includes('<!-- profile:web:start -->') && agents.includes('<!-- profile:web:end -->'));
});

test('kit.json lists explicit skill names, never "*"', async () => {
  const m = await loadManifest(kitDir);
  for (const def of Object.values(m.profiles)) for (const s of def.skills || []) assert.ok(Array.isArray(s.skills) && s.skills.length > 0, s.repo);
  const dir = await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'star-'));
  await fs.writeFile(path.join(dir, 'kit.json'), JSON.stringify({ version: 1, profiles: { core: { skills: [{ repo: 'a/b', skills: '*' }] } } }));
  await assert.rejects(loadManifest(dir), /must be a list/);
});

test('templates carry the git rules themselves and do not lean on a personal global file', async () => {
  const agents = await fs.readFile(path.join(kitDir, 'templates/AGENTS.md'), 'utf8');
  assert.match(agents, /^## Git$/m);
  assert.match(agents, /Never commit directly to `main` or `master`/);
  assert.match(agents, /Conventional Commits/);
  assert.match(agents, /Never add `Co-Authored-By` trailers/);
  const claude = await fs.readFile(path.join(kitDir, 'templates/CLAUDE.md'), 'utf8');
  assert.ok(!claude.includes('~/.claude/CLAUDE.md'));
});
