import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseArgs, resolveCommand, assertSafeCmdArgs, createRunner } from '../install.mjs';

test('parseArgs flags', () => {
  const o = parseArgs(['--profile', 'web', '--dry-run', '--yes', '--skip-user', '--only', 'skills,mcp']);
  assert.equal(o.profile, 'web');
  assert.equal(o.dryRun, true);
  assert.equal(o.yes, true);
  assert.equal(o.skipUser, true);
  assert.deepEqual(o.only, new Set(['skills', 'mcp']));
  assert.equal(typeof o.projectDir, 'string');
});

test('parseArgs defaults and errors', () => {
  const o = parseArgs([]);
  assert.equal(o.profile, 'core');
  assert.equal(o.only, null);
  assert.throws(() => parseArgs(['--profile', 'x']), /--profile must be core or web/);
  assert.throws(() => parseArgs(['--bogus']), /unknown flag: --bogus/);
  assert.throws(() => parseArgs(['--only', 'agents,zzz']), /unknown layer zzz/);
});

const win = (exists, extra = {}) => ({
  platform: 'win32',
  pathEnv: 'C:\\bin',
  pathExt: '.COM;.EXE;.BAT;.CMD',
  execPath: 'C:\\nodejs\\node.exe',
  exists,
  ...extra,
});

test('resolveCommand npx on windows uses npx-cli.js', () => {
  const r = resolveCommand('npx', win((p) => p.endsWith('npx-cli.js')));
  assert.equal(r.file, 'C:\\nodejs\\node.exe');
  assert.equal(r.prefixArgs.length, 1);
  assert.ok(r.prefixArgs[0].endsWith('node_modules\\npm\\bin\\npx-cli.js'));
});

test('resolveCommand npx on windows falls back to cmd.exe', () => {
  const r = resolveCommand('npx', win(() => false));
  assert.deepEqual(r, { file: 'cmd.exe', prefixArgs: ['/d', '/s', '/c', 'npx'] });
});

test('resolveCommand claude on windows exe, cmd, missing', () => {
  assert.deepEqual(resolveCommand('claude', win((p) => p === 'C:\\bin\\claude.exe')), {
    file: 'C:\\bin\\claude.exe',
    prefixArgs: [],
  });
  assert.deepEqual(resolveCommand('claude', win((p) => p === 'C:\\bin\\claude.cmd')), {
    file: 'cmd.exe',
    prefixArgs: ['/d', '/s', '/c', 'C:\\bin\\claude.cmd'],
  });
  assert.equal(resolveCommand('claude', win(() => false)), null);
});

test('resolveCommand posix', () => {
  const r = resolveCommand('git', {
    platform: 'linux',
    pathEnv: '/usr/bin',
    pathExt: '',
    execPath: '/usr/bin/node',
    exists: (p) => p === '/usr/bin/git',
  });
  assert.deepEqual(r, { file: '/usr/bin/git', prefixArgs: [] });
});

test('assertSafeCmdArgs', () => {
  assert.throws(() => assertSafeCmdArgs(['a&b']), /unsafe argument/);
  assert.throws(() => assertSafeCmdArgs(['a"b']), /unsafe argument/);
  assert.throws(() => assertSafeCmdArgs(['a\nb']), /unsafe argument/);
  assert.doesNotThrow(() => assertSafeCmdArgs(['owner/repo', '*', '--skill']));
});

function fakeSpawn({ stdout = '', stderr = '', code = 0, error } = {}) {
  const calls = [];
  const fn = (file, args, opts) => {
    calls.push({ file, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (error) return child.emit('error', new Error(error));
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code);
    });
    return child;
  };
  return { fn, calls };
}

const posixEnv = (names) => ({
  platform: 'linux',
  pathEnv: '/bin',
  pathExt: '',
  execPath: '/bin/node',
  exists: (p) => names.some((n) => p === '/bin/' + n),
});

test('runner returns output', async () => {
  const s = fakeSpawn({ stdout: 'hi' });
  const run = createRunner({ dryRun: false, log() {}, spawnFn: s.fn, env: posixEnv(['git']) });
  const r = await run('git', ['status'], { cwd: '/p' });
  assert.deepEqual(r, { code: 0, stdout: 'hi', stderr: '' });
  assert.equal(s.calls[0].opts.shell, false);
  assert.equal(s.calls[0].opts.cwd, '/p');
});

test('runner dry-run skips spawn unless readOnly', async () => {
  const s = fakeSpawn({ stdout: 'x' });
  const logs = [];
  const run = createRunner({ dryRun: true, log: (l) => logs.push(l), spawnFn: s.fn, env: posixEnv(['git']) });
  const a = await run('git', ['push']);
  assert.equal(a.code, 0);
  assert.equal(s.calls.length, 0);
  assert.match(logs[0], /\[dry-run\] git push/);
  await run('git', ['status'], { readOnly: true });
  assert.equal(s.calls.length, 1);
});

test('runner unresolved command and spawn error', async () => {
  const run = createRunner({ dryRun: false, log() {}, spawnFn: fakeSpawn().fn, env: posixEnv([]) });
  assert.deepEqual(await run('nope', []), { code: 127, stdout: '', stderr: 'command not found: nope' });
  const run2 = createRunner({ dryRun: false, log() {}, spawnFn: fakeSpawn({ error: 'boom' }).fn, env: posixEnv(['git']) });
  assert.deepEqual(await run2('git', []), { code: 1, stdout: '', stderr: 'boom' });
});

test('runner keeps spaces and Thai in one argv element', async () => {
  const s = fakeSpawn();
  const run = createRunner({ dryRun: false, log() {}, spawnFn: s.fn, env: posixEnv(['claude']) });
  await run('claude', ['mcp', 'add', 'โปรเจกต์ ใหม่']);
  assert.equal(s.calls[0].args[2], 'โปรเจกต์ ใหม่');
});

test('runner rejects unsafe args when going through cmd.exe', async () => {
  const s = fakeSpawn();
  const run = createRunner({ dryRun: false, log() {}, spawnFn: s.fn, env: win(() => false) });
  const r = await run('npx', ['a&b']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unsafe argument/);
  assert.equal(s.calls.length, 0);
});

test('cmd.exe shim: one verbatim command line, path with spaces', async () => {
  const s = fakeSpawn();
  const env = win((p) => p === 'C:\\bin dir\\claude.cmd', { pathEnv: 'C:\\bin dir' });
  const run = createRunner({ dryRun: false, log() {}, spawnFn: s.fn, env });
  await run('claude', ['plugin', 'list', 'a b']);
  const c = s.calls[0];
  assert.equal(c.file, 'cmd.exe');
  assert.deepEqual(c.args, ['/d', '/s', '/c', '""C:\\bin dir\\claude.cmd" "plugin" "list" "a b""']);
  assert.equal(c.opts.windowsVerbatimArguments, true);
});

test('cmd.exe shim in a path with & is rejected', async () => {
  const s = fakeSpawn();
  const env = win((p) => p === 'C:\\R&D\\claude.cmd', { pathEnv: 'C:\\R&D' });
  const run = createRunner({ dryRun: false, log() {}, spawnFn: s.fn, env });
  const r = await run('claude', ['x']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unsafe argument/);
  assert.equal(s.calls.length, 0);
});

test('runner closes stdin and times out hung children', async () => {
  let killed = false;
  const calls = [];
  const hung = (file, args, opts) => {
    calls.push(opts);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { killed = true; setImmediate(() => child.emit('close', null)); };
    return child;
  };
  const run = createRunner({ dryRun: false, log() {}, spawnFn: hung, env: posixEnv(['claude']) });
  const r = await run('claude', ['plugin', 'marketplace', 'add', 'x'], { timeoutMs: 30 });
  assert.deepEqual(calls[0].stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(r.code, 124);
  assert.match(r.stderr, /timed out/);
  assert.equal(killed, true);
});

test('real .cmd shim in a directory with spaces works on windows', { skip: process.platform !== 'win32' }, async () => {
  const fsp = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'shim-'));
  const dir = path.join(root, 'bin dir');
  await fsp.mkdir(dir);
  await fsp.writeFile(path.join(dir, 'claude.cmd'), ['@echo off', 'echo got %1 %2', ''].join(String.fromCharCode(13, 10)));
  const env = { ...(await import('../install.mjs')).defaultEnv(), pathEnv: dir };
  const run = createRunner({ dryRun: false, log() {}, env });
  const r = await run('claude', ['plugin', 'list']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /got "?plugin"? "?list"?/);
});
