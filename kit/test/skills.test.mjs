import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSkills } from '../install.mjs';
import { makeTempProject, fakeRunner } from './helpers.mjs';

const kitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function ctx(dir, run, { skills = [], bundledSkills = [], dryRun = false, platform = 'linux' } = {}) {
  return {
    kitDir,
    projectDir: dir,
    manifest: { skillsCli: 'skills@1.9.0' },
    profile: { name: 'core', agentDirs: [], skills, bundledSkills, mcp: [], plugins: [] },
    run,
    opts: { dryRun },
    platform,
    log() {},
  };
}

const named = [{ repo: 'Piya-Boy/piya-skill', skills: ['thai-natural-writing'] }];
const writeLock = (dir, skills) => fs.writeFile(path.join(dir, 'skills-lock.json'), JSON.stringify({ version: 2, skills }));

test('named skill missing: one npx add call', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner();
  const res = await installSkills(ctx(dir, f.run, { skills: named }));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].cmd, 'npx');
  assert.deepEqual(f.calls[0].args, [
    '-y', 'skills@1.9.0', 'add', 'Piya-Boy/piya-skill', '--agent', 'claude-code', '--skill', 'thai-natural-writing', '-y',
  ]);
  assert.equal(f.calls[0].o.cwd, dir);
  assert.equal(res[0].status, 'installed');
});

test('already in lock or on disk: skipped, no calls', async () => {
  const dir = await makeTempProject();
  await writeLock(dir, { 'thai-natural-writing': { source: 'Piya-Boy/piya-skill' } });
  const f = fakeRunner();
  const res = await installSkills(ctx(dir, f.run, { skills: named }));
  assert.equal(f.calls.length, 0);
  assert.equal(res[0].status, 'skipped');
  const dir2 = await makeTempProject();
  await fs.mkdir(path.join(dir2, '.claude/skills/strategic-compact'), { recursive: true });
  await fs.writeFile(path.join(dir2, '.claude/skills/strategic-compact/SKILL.md'), 'x');
  const f2 = fakeRunner();
  const res2 = await installSkills(ctx(dir2, f2.run, { skills: [{ repo: 'GRJY/Claude-Code-skill', skills: ['strategic-compact'] }] }));
  assert.equal(f2.calls.length, 0);
  assert.equal(res2[0].status, 'skipped');
});

test('star repo: one call with --skill *; skipped when lock has the repo', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner();
  await installSkills(ctx(dir, f.run, { skills: [{ repo: 'mattpocock/skills', skills: '*' }] }));
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].args.slice(-3), ['--skill', '*', '-y']);
  const dir2 = await makeTempProject();
  await writeLock(dir2, { tdd: { source: 'mattpocock/skills' } });
  const f2 = fakeRunner();
  const res = await installSkills(ctx(dir2, f2.run, { skills: [{ repo: 'mattpocock/skills', skills: '*' }] }));
  assert.equal(f2.calls.length, 0);
  assert.equal(res[0].status, 'skipped');
});

test('windows copy fallback', async () => {
  const dir = await makeTempProject();
  let n = 0;
  const f = fakeRunner(() => (n++ === 0 ? { code: 1, stderr: 'link failed' } : {}));
  const res = await installSkills(ctx(dir, f.run, { skills: named, platform: 'win32' }));
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[1].args.includes('--copy'));
  assert.equal(res[0].status, 'installed');
  assert.match(res[0].detail, /copy fallback/);
  const f2 = fakeRunner(() => ({ code: 1, stderr: 'bad\nlast line' }));
  const res2 = await installSkills(ctx(await makeTempProject(), f2.run, { skills: named, platform: 'win32' }));
  assert.equal(f2.calls.length, 2);
  assert.equal(res2[0].status, 'failed');
  assert.match(res2[0].detail, /last line/);
  const f3 = fakeRunner(() => ({ code: 1, stderr: 'nope' }));
  const res3 = await installSkills(ctx(await makeTempProject(), f3.run, { skills: named, platform: 'linux' }));
  assert.equal(f3.calls.length, 1);
  assert.equal(res3[0].status, 'failed');
});

test('a failing repo does not stop the next', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner((cmd, args) => (args.includes('a/one') ? { code: 1, stderr: 'x' } : {}));
  const res = await installSkills(
    ctx(dir, f.run, { skills: [{ repo: 'a/one', skills: ['s1'] }, { repo: 'b/two', skills: ['s2'] }] }),
  );
  assert.deepEqual(res.map((r) => r.status), ['failed', 'installed']);
});

test('bundled skill copied with references, then skipped; existing untouched', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner();
  const res = await installSkills(ctx(dir, f.run, { bundledSkills: ['software-engineer'] }));
  assert.equal(res[0].status, 'installed');
  await fs.access(path.join(dir, '.claude/skills/software-engineer/references/workflow-patterns.md'));
  const again = await installSkills(ctx(dir, f.run, { bundledSkills: ['software-engineer'] }));
  assert.equal(again[0].status, 'skipped');
  const dir2 = await makeTempProject();
  await fs.mkdir(path.join(dir2, '.claude/skills/software-engineer'), { recursive: true });
  await fs.writeFile(path.join(dir2, '.claude/skills/software-engineer/MARK'), 'mine');
  const r2 = await installSkills(ctx(dir2, f.run, { bundledSkills: ['software-engineer'] }));
  assert.equal(r2[0].status, 'skipped');
  assert.equal(await fs.readFile(path.join(dir2, '.claude/skills/software-engineer/MARK'), 'utf8'), 'mine');
});

test('dry-run: dry-run results, no bundled copy', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner();
  const res = await installSkills(ctx(dir, f.run, { skills: named, bundledSkills: ['software-engineer'], dryRun: true }));
  assert.deepEqual(res.map((r) => r.status), ['dry-run', 'dry-run']);
  await assert.rejects(fs.access(path.join(dir, '.claude')));
});
