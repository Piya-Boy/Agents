import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { installPlugins, preflight, confirm, listSources, formatSummary, main, loadManifest, resolveProfile } from '../install.mjs';
import { makeTempProject, fakeRunner } from './helpers.mjs';

const kitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const okEnv = { nodeVersion: '24.0.0', resolve: () => ({}) };

test('confirm', async () => {
  let asked = 0;
  const ask = async () => (asked++, 'Y');
  assert.equal(await confirm('q', { yes: true, isTTY: false, ask }), true);
  assert.equal(asked, 0);
  await assert.rejects(confirm('q', { yes: false, isTTY: false, ask }), /--yes/);
  assert.equal(await confirm('q', { yes: false, isTTY: true, ask: async () => 'yes' }), true);
  assert.equal(await confirm('q', { yes: false, isTTY: true, ask: async () => 'n' }), false);
  assert.equal(await confirm('q', { yes: false, isTTY: true, ask: async () => '' }), false);
});

test('preflight', () => {
  const low = preflight({ nodeVersion: '22.19.9', resolve: () => ({}) });
  assert.equal(low.ok, false);
  assert.match(low.problems[0], /22\.20\.0/);
  assert.equal(preflight({ nodeVersion: '22.20.0', resolve: () => ({}) }).ok, true);
  assert.equal(preflight({ nodeVersion: '24.1.0', resolve: () => ({}) }).ok, true);
  const noClaude = preflight({ nodeVersion: '24.1.0', resolve: (n) => (n === 'claude' ? null : {}) });
  assert.equal(noClaude.ok, false);
  assert.ok(noClaude.problems.includes('claude not found on PATH'));
});

const pluginCtx = (run, { isTTY = true, dryRun = false } = {}) => ({
  kitDir,
  projectDir: '/p',
  manifest: {
    plugins: { 'ui-ux-pro-max': { marketplace: 'nextlevelbuilder/ui-ux-pro-max-skill', id: 'ui-ux-pro-max@ui-ux-pro-max-skill' } },
  },
  profile: { name: 'web', agentDirs: [], skills: [], bundledSkills: [], mcp: [], plugins: ['ui-ux-pro-max'] },
  run,
  opts: { dryRun },
  isTTY,
  log() {},
});

test('installPlugins happy path, never -y', async () => {
  const f = fakeRunner((cmd, args) => (args[1] === 'list' ? { stdout: '[]' } : {}));
  const res = await installPlugins(pluginCtx(f.run));
  assert.deepEqual(f.calls.map((c) => c.args.slice(0, 3)), [
    ['plugin', 'list', '--json'],
    ['plugin', 'marketplace', 'add'],
    ['plugin', 'install', 'ui-ux-pro-max@ui-ux-pro-max-skill'],
  ]);
  assert.deepEqual(f.calls[1].args, ['plugin', 'marketplace', 'add', 'nextlevelbuilder/ui-ux-pro-max-skill', '--scope', 'user']);
  assert.deepEqual(f.calls[2].args, ['plugin', 'install', 'ui-ux-pro-max@ui-ux-pro-max-skill', '--scope', 'user']);
  assert.equal(f.calls[2].o.inherit, true);
  assert.ok(f.calls.every((c) => !c.args.includes('-y')));
  assert.equal(res[0].status, 'installed');
});

test('installPlugins skip, no tty, marketplace failure', async () => {
  const f = fakeRunner(() => ({ stdout: '[{"id":"ui-ux-pro-max@ui-ux-pro-max-skill"}]' }));
  const res = await installPlugins(pluginCtx(f.run));
  assert.equal(f.calls.length, 1);
  assert.equal(res[0].status, 'skipped');
  const f2 = fakeRunner((cmd, args) => (args[1] === 'list' ? { stdout: '[]' } : {}));
  const res2 = await installPlugins(pluginCtx(f2.run, { isTTY: false }));
  assert.equal(res2[0].status, 'failed');
  assert.match(res2[0].detail, /terminal/);
  assert.ok(!f2.calls.some((c) => c.args[1] === 'install'));
  const f3 = fakeRunner((cmd, args) => (args[1] === 'list' ? { stdout: '[]' } : args[1] === 'marketplace' ? { code: 1, stderr: 'bad' } : {}));
  const res3 = await installPlugins(pluginCtx(f3.run));
  assert.equal(res3[0].status, 'failed');
  assert.ok(!f3.calls.some((c) => c.args[1] === 'install'));
});

test('listSources and formatSummary', async () => {
  const m = await loadManifest(kitDir);
  const lines = listSources(resolveProfile(m, 'web'), m, null);
  assert.ok(lines.includes('skills: Piya-Boy/piya-skill'));
  assert.ok(lines.includes('mcp: npx @upstash/context7-mcp'));
  assert.ok(lines.includes('plugin: nextlevelbuilder/ui-ux-pro-max-skill'));
  const s = formatSummary([
    { layer: 'agents', item: 'qa.md', status: 'installed' },
    { layer: 'mcp', item: 'context7', status: 'failed', detail: 'boom' },
  ]);
  assert.match(s, /failed 1/);
  assert.match(s, /restart Claude Code/i);
});

function fakeSpawnCounter() {
  const calls = [];
  const fn = (file, args) => {
    calls.push({ file, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('[]'));
      child.emit('close', 0);
    });
    return child;
  };
  return { fn, calls };
}
const posixCmdEnv = {
  platform: 'linux', pathEnv: '/bin', pathExt: '', execPath: '/bin/node',
  exists: (p) => ['/bin/claude', '/bin/npx', '/bin/git'].includes(p),
};

test('main dry-run changes nothing and spawns only read-only commands', async () => {
  const dir = await makeTempProject();
  const sp = fakeSpawnCounter();
  const logs = [];
  const code = await main(['--profile', 'web', '--dry-run', '--yes'], {
    projectDir: dir, env: okEnv, spawnFn: sp.fn, cmdEnv: posixCmdEnv, log: (l) => logs.push(l), isTTY: false,
  });
  assert.equal(code, 0);
  assert.deepEqual(await fs.readdir(dir), []);
  assert.ok(sp.calls.every((c) => c.args.includes('list')), 'only plugin list may spawn');
  assert.ok(logs.some((l) => l.includes('[dry-run]')));
});

test('main real files for --only agents,rules', async () => {
  const dir = await makeTempProject();
  const code = await main(['--only', 'agents,rules'], { projectDir: dir, env: okEnv, log() {}, isTTY: false, run: fakeRunner().run });
  assert.equal(code, 0);
  await fs.access(path.join(dir, '.claude/agents/qa.md'));
  await fs.access(path.join(dir, 'AGENTS.md'));
});

test('main: failing mcp add -> exit 1 but plugins layer still ran', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner((cmd, args) => {
    if (args[0] === 'plugin' && args[1] === 'list') return { stdout: '[]' };
    if (args[0] === 'mcp') return { code: 1, stderr: 'no' };
    return {};
  });
  const code = await main(['--profile', 'web', '--yes', '--only', 'mcp,plugins'], {
    projectDir: dir, env: okEnv, log() {}, isTTY: true, run: f.run,
  });
  assert.equal(code, 1);
  assert.ok(f.calls.some((c) => c.args[1] === 'install'));
});

test('main: preflight failure and declined consent change nothing', async () => {
  const dir = await makeTempProject();
  const logs = [];
  const code = await main([], { projectDir: dir, env: { nodeVersion: '20.0.0', resolve: () => ({}) }, log: (l) => logs.push(l), run: fakeRunner().run });
  assert.equal(code, 1);
  assert.deepEqual(await fs.readdir(dir), []);
  assert.ok(logs.join('\n').includes('22.20.0'));
  const f = fakeRunner();
  const code2 = await main([], { projectDir: dir, env: okEnv, log() {}, isTTY: true, ask: async () => 'n', run: f.run });
  assert.equal(code2, 1);
  assert.deepEqual(await fs.readdir(dir), []);
  assert.equal(f.calls.length, 0);
});

test('main: no tty and no --yes refuses without asking', async () => {
  const dir = await makeTempProject();
  const logs = [];
  let asked = 0;
  const code = await main(['--only', 'skills'], {
    projectDir: dir, env: okEnv, log: (l) => logs.push(l), isTTY: false, ask: async () => (asked++, 'y'), run: fakeRunner().run,
  });
  assert.equal(code, 1);
  assert.equal(asked, 0);
  assert.ok(logs.join('\n').includes('--yes'));
});

test('main --skip-user skips plugins without a second prompt', async () => {
  const dir = await makeTempProject();
  const logs = [];
  let asked = 0;
  const f = fakeRunner((cmd, args) => (args[0] === 'plugin' ? { stdout: '[]' } : {}));
  const code = await main(['--profile', 'web', '--only', 'plugins', '--skip-user', '--yes'], {
    projectDir: dir, env: okEnv, log: (l) => logs.push(l), isTTY: false, ask: async () => (asked++, 'y'), run: f.run,
  });
  assert.equal(code, 0);
  assert.equal(asked, 0);
  assert.ok(!f.calls.some((c) => c.args[1] === 'install'));
  assert.ok(logs.join('\n').includes('--skip-user'));
});

test('plugin consent says plugins edit ~/.claude/settings.json', async () => {
  const dir = await makeTempProject();
  const logs = [];
  const f = fakeRunner((cmd, args) => (args[0] === 'plugin' && args[1] === 'list' ? { stdout: '[]' } : {}));
  await main(['--profile', 'web', '--only', 'plugins', '--yes'], { projectDir: dir, env: okEnv, log: (l) => logs.push(l), isTTY: true, run: f.run });
  assert.match(logs.join(String.fromCharCode(10)), /settings\.json/);
});

test('running through a symlink or junction still runs main', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'junc-'));
  const link = path.join(root, 'kitlink');
  await fs.symlink(kitDir, link, 'junction');
  const r = spawnSync(process.execPath, [path.join(link, 'install.mjs'), '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /unknown flag: --bogus/);
});

test('main: unknown profile exits 1 with a clear message', async () => {
  const dir = await makeTempProject();
  const logs = [];
  const code = await main(['--profile', 'nope'], { projectDir: dir, env: okEnv, log: (l) => logs.push(l), run: fakeRunner().run });
  assert.equal(code, 1);
  assert.match(logs.join(' '), /unknown profile: nope/);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('main: --profile superpowers adds the plugin to core, without web agents', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner((cmd, args) => (args[0] === 'plugin' && args[1] === 'list' ? { stdout: '[]' } : {}));
  const code = await main(['--profile', 'superpowers', '--yes', '--only', 'agents,rules,plugins'], {
    projectDir: dir, env: okEnv, log() {}, isTTY: true, run: f.run,
  });
  assert.equal(code, 0);
  assert.ok(f.calls.some((c) => c.args[1] === 'install' && c.args[2] === 'superpowers@claude-plugins-official'));
  assert.equal((await fs.readdir(path.join(dir, '.claude/agents'))).length, 10);
  const agents = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(!agents.includes('profile:web'));
});

test('main: --profile web,superpowers keeps the web section', async () => {
  const dir = await makeTempProject();
  const code = await main(['--profile', 'web,superpowers', '--only', 'rules,agents'], { projectDir: dir, env: okEnv, log() {}, run: fakeRunner().run });
  assert.equal(code, 0);
  assert.ok((await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8')).includes('profile:web:start'));
  assert.equal((await fs.readdir(path.join(dir, '.claude/agents'))).length, 13);
});
