import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readMcpJson, installMcp } from '../install.mjs';
import { makeTempProject, fakeRunner } from './helpers.mjs';

const manifest = {
  mcp: {
    context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'], coveredByPlugin: 'context7@' },
    'chrome-devtools': { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'], coveredByPlugin: 'chrome-devtools-mcp@' },
  },
};

const ctx = (dir, run, mcp, dryRun = false) => ({
  kitDir: '',
  projectDir: dir,
  manifest,
  profile: { name: 'core', agentDirs: [], skills: [], bundledSkills: [], mcp, plugins: [] },
  run,
  opts: { dryRun },
  log() {},
});

test('readMcpJson cases', async () => {
  const dir = await makeTempProject();
  const f = path.join(dir, '.mcp.json');
  assert.deepEqual(await readMcpJson(f), { mcpServers: {} });
  await fs.writeFile(f, '');
  assert.deepEqual(await readMcpJson(f), { mcpServers: {} });
  await fs.writeFile(f, '{"mcpServers":{"a":{}}}');
  assert.deepEqual(await readMcpJson(f), { mcpServers: { a: {} } });
  await fs.writeFile(f, '{"x":1}');
  assert.deepEqual(await readMcpJson(f), { x: 1, mcpServers: {} });
  await fs.writeFile(f, '{not json');
  await assert.rejects(readMcpJson(f), /not valid JSON/);
});

test('missing server: plugin check then mcp add', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, '.mcp.json'), '');
  const f = fakeRunner((cmd, args) => (args[0] === 'plugin' ? { stdout: '[]' } : {}));
  const res = await installMcp(ctx(dir, f.run, ['context7']));
  assert.deepEqual(f.calls[0].args, ['plugin', 'list', '--json']);
  assert.equal(f.calls[0].o.readOnly, true);
  assert.deepEqual(f.calls[1].args, [
    'mcp', 'add', '--scope', 'project', '--transport', 'stdio', 'context7', '--', 'npx', '-y', '@upstash/context7-mcp',
  ]);
  assert.equal(f.calls[1].cmd, 'claude');
  assert.equal(res[0].status, 'installed');
});

test('already in .mcp.json: skipped', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { context7: {} } }));
  const f = fakeRunner(() => ({ stdout: '[]' }));
  const res = await installMcp(ctx(dir, f.run, ['context7']));
  assert.equal(res[0].status, 'skipped');
  assert.ok(!f.calls.some((c) => c.args[0] === 'mcp'));
});

test('covered by plugin: skipped with detail', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner(() => ({ stdout: '[{"id":"context7@claude-plugins-official"}]' }));
  const res = await installMcp(ctx(dir, f.run, ['context7']));
  assert.equal(res[0].status, 'skipped');
  assert.match(res[0].detail, /covered by plugin context7@claude-plugins-official/);
  assert.ok(!f.calls.some((c) => c.args[0] === 'mcp'));
});

test('invalid .mcp.json: failed, file untouched, no add', async () => {
  const dir = await makeTempProject();
  const file = path.join(dir, '.mcp.json');
  await fs.writeFile(file, '{not json');
  const f = fakeRunner(() => ({ stdout: '[]' }));
  const res = await installMcp(ctx(dir, f.run, ['context7', 'chrome-devtools']));
  assert.ok(res.every((r) => r.status === 'failed' && /not valid JSON/.test(r.detail)));
  assert.ok(!f.calls.some((c) => c.args[0] === 'mcp'));
  assert.equal(await fs.readFile(file, 'utf8'), '{not json');
});

test('two servers in order; versioned package stays one arg; failure does not stop next', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner((cmd, args) => {
    if (args[0] === 'plugin') return { stdout: '[]' };
    if (args.includes('context7')) return { code: 1, stderr: 'oops\nlast' };
    return {};
  });
  const res = await installMcp(ctx(dir, f.run, ['context7', 'chrome-devtools']));
  const adds = f.calls.filter((c) => c.args[0] === 'mcp');
  assert.equal(adds.length, 2);
  assert.equal(adds[1].args[adds[1].args.length - 1], 'chrome-devtools-mcp@latest');
  assert.deepEqual(res.map((r) => r.status), ['failed', 'installed']);
  assert.equal(res[0].detail, 'last');
});

test('unparseable plugin list counts as none', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner((cmd, args) => (args[0] === 'plugin' ? { stdout: 'garbage' } : {}));
  const res = await installMcp(ctx(dir, f.run, ['context7']));
  assert.equal(res[0].status, 'installed');
});
