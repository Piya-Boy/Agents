import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeMcpServers, MCP_FILES } from '../mcp-config.mjs';
import { installMcp, loadManifest, resolveProfiles } from '../install.mjs';
import { makeTempProject, fakeRunner } from './helpers.mjs';

const kitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = (p) => fs.access(p).then(() => true, () => false);
const read = (dir, rel) => fs.readFile(path.join(dir, ...rel.split('/')), 'utf8');

const c7 = { name: 'context7', def: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] } };
const cd = { name: 'chrome-devtools', def: { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] } };

test('file paths per tool', () => {
  assert.deepEqual(MCP_FILES, {
    copilot: '.mcp.json',
    cursor: '.cursor/mcp.json',
    gemini: '.gemini/settings.json',
    codex: '.codex/config.toml',
    antigravity: '.agents/mcp_config.json',
  });
});

test('cursor: creates .cursor/mcp.json with command and args', async () => {
  const dir = await makeTempProject();
  const rows = await writeMcpServers({ tool: 'cursor', projectDir: dir, servers: [c7, cd], dryRun: false });
  assert.deepEqual(rows.map((r) => r.status), ['installed', 'installed']);
  const obj = JSON.parse(await read(dir, '.cursor/mcp.json'));
  assert.deepEqual(obj.mcpServers.context7, { command: 'npx', args: ['-y', '@upstash/context7-mcp'] });
  assert.deepEqual(Object.keys(obj.mcpServers), ['context7', 'chrome-devtools']);
});

test('copilot: .mcp.json entries carry type stdio', async () => {
  const dir = await makeTempProject();
  await writeMcpServers({ tool: 'copilot', projectDir: dir, servers: [c7], dryRun: false });
  assert.deepEqual(JSON.parse(await read(dir, '.mcp.json')).mcpServers.context7, { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] });
});

test('gemini: merges into settings.json and keeps every other key', async () => {
  const dir = await makeTempProject();
  await fs.mkdir(path.join(dir, '.gemini'));
  await fs.writeFile(path.join(dir, '.gemini/settings.json'), JSON.stringify({ context: { fileName: ['AGENTS.md'] }, mcpServers: { mine: { command: 'x' } } }));
  const rows = await writeMcpServers({ tool: 'gemini', projectDir: dir, servers: [c7], dryRun: false });
  assert.equal(rows[0].status, 'installed');
  const obj = JSON.parse(await read(dir, '.gemini/settings.json'));
  assert.deepEqual(obj.context, { fileName: ['AGENTS.md'] });
  assert.deepEqual(obj.mcpServers.mine, { command: 'x' });
  assert.ok(obj.mcpServers.context7);
});

test('json: an entry that already exists is not changed; second run adds nothing', async () => {
  const dir = await makeTempProject();
  await fs.mkdir(path.join(dir, '.cursor'));
  await fs.writeFile(path.join(dir, '.cursor/mcp.json'), JSON.stringify({ mcpServers: { context7: { command: 'custom' } } }));
  const rows = await writeMcpServers({ tool: 'cursor', projectDir: dir, servers: [c7, cd], dryRun: false });
  assert.deepEqual(rows.map((r) => r.status), ['skipped', 'installed']);
  const obj = JSON.parse(await read(dir, '.cursor/mcp.json'));
  assert.deepEqual(obj.mcpServers.context7, { command: 'custom' });
  const again = await writeMcpServers({ tool: 'cursor', projectDir: dir, servers: [c7, cd], dryRun: false });
  assert.deepEqual(again.map((r) => r.status), ['skipped', 'skipped']);
});

test('json: invalid or non-object file is reported failed and left untouched', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, '.mcp.json'), '{not json');
  const rows = await writeMcpServers({ tool: 'copilot', projectDir: dir, servers: [c7], dryRun: false });
  assert.equal(rows[0].status, 'failed');
  assert.match(rows[0].detail, /not valid JSON/);
  assert.equal(await read(dir, '.mcp.json'), '{not json');
  await fs.writeFile(path.join(dir, '.mcp.json'), '[1]');
  assert.equal((await writeMcpServers({ tool: 'copilot', projectDir: dir, servers: [c7], dryRun: false }))[0].status, 'failed');
  assert.equal(await read(dir, '.mcp.json'), '[1]');
});

test('json: BOM and CRLF are handled; empty file counts as empty', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, '.mcp.json'), '﻿{\r\n  "mcpServers": {}\r\n}\r\n');
  await writeMcpServers({ tool: 'copilot', projectDir: dir, servers: [c7], dryRun: false });
  const text = await read(dir, '.mcp.json');
  assert.ok(!/[^\r]\n/.test(text), 'CRLF kept');
  assert.ok(JSON.parse(text.replace(/^﻿/, '')).mcpServers.context7);
  const dir2 = await makeTempProject();
  await fs.writeFile(path.join(dir2, '.mcp.json'), '');
  assert.equal((await writeMcpServers({ tool: 'copilot', projectDir: dir2, servers: [c7], dryRun: false }))[0].status, 'installed');
});

test('codex: appends [mcp_servers.x] tables; valid TOML shape', async () => {
  const dir = await makeTempProject();
  const rows = await writeMcpServers({ tool: 'codex', projectDir: dir, servers: [c7, cd], dryRun: false });
  assert.deepEqual(rows.map((r) => r.status), ['installed', 'installed']);
  assert.equal(
    await read(dir, '.codex/config.toml'),
    '[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y","@upstash/context7-mcp"]\n\n[mcp_servers.chrome-devtools]\ncommand = "npx"\nargs = ["-y","chrome-devtools-mcp@latest"]\n',
  );
});

test('codex: keeps existing config, separates with a blank line, skips tables that exist', async () => {
  const dir = await makeTempProject();
  await fs.mkdir(path.join(dir, '.codex'));
  await fs.writeFile(path.join(dir, '.codex/config.toml'), 'model = "x"\n\n[mcp_servers.context7.env]\nK = "v"\n');
  const rows = await writeMcpServers({ tool: 'codex', projectDir: dir, servers: [c7, cd], dryRun: false });
  assert.deepEqual(rows.map((r) => r.status), ['skipped', 'installed']);
  const text = await read(dir, '.codex/config.toml');
  assert.ok(text.startsWith('model = "x"\n\n[mcp_servers.context7.env]\nK = "v"\n\n[mcp_servers.chrome-devtools]'));
  assert.equal((text.match(/\[mcp_servers\.context7/g) || []).length, 1);
  const dir2 = await makeTempProject();
  await fs.mkdir(path.join(dir2, '.codex'));
  await fs.writeFile(path.join(dir2, '.codex/config.toml'), 'model = "x"');
  await writeMcpServers({ tool: 'codex', projectDir: dir2, servers: [c7], dryRun: false });
  assert.ok((await read(dir2, '.codex/config.toml')).startsWith('model = "x"\n\n[mcp_servers.context7]'));
  const dir3 = await makeTempProject();
  await fs.mkdir(path.join(dir3, '.codex'));
  await fs.writeFile(path.join(dir3, '.codex/config.toml'), '[mcp_servers."context7"]\ncommand = "a"\n');
  assert.equal((await writeMcpServers({ tool: 'codex', projectDir: dir3, servers: [c7], dryRun: false }))[0].status, 'skipped');
});

test('dry-run writes nothing for every tool', async () => {
  const dir = await makeTempProject();
  for (const tool of Object.keys(MCP_FILES)) {
    const rows = await writeMcpServers({ tool, projectDir: dir, servers: [c7], dryRun: true });
    assert.equal(rows[0].status, 'dry-run');
  }
  assert.deepEqual(await fs.readdir(dir), []);
});

test('unknown tool or no servers: no rows', async () => {
  const dir = await makeTempProject();
  assert.deepEqual(await writeMcpServers({ tool: 'claude', projectDir: dir, servers: [c7], dryRun: false }), []);
  assert.deepEqual(await writeMcpServers({ tool: 'cursor', projectDir: dir, servers: [], dryRun: false }), []);
});

async function mcpCtx(dir, tools, run, profileName = 'web') {
  const manifest = await loadManifest(kitDir);
  return { kitDir, projectDir: dir, manifest, profile: resolveProfiles(manifest, [profileName]), run, opts: { dryRun: false, tools }, log() {} };
}

test('installMcp: non-Claude tools never call the claude CLI and ignore plugin coverage', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner(() => ({ stdout: '[{"id":"context7@claude-plugins-official"}]' }));
  const res = await installMcp(await mcpCtx(dir, ['cursor', 'codex'], f.run));
  assert.equal(f.calls.length, 0);
  assert.equal(res.length, 4);
  assert.ok(res.every((r) => r.layer === 'mcp' && r.status === 'installed'));
  assert.equal(await exists(path.join(dir, '.cursor/mcp.json')), true);
  assert.equal(await exists(path.join(dir, '.codex/config.toml')), true);
  assert.equal(await exists(path.join(dir, '.mcp.json')), false);
});

test('installMcp: claude plus copilot adds the entry Claude skipped because a plugin covers it', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner(() => ({ stdout: '[{"id":"context7@claude-plugins-official"}]' }));
  const res = await installMcp(await mcpCtx(dir, ['claude', 'copilot'], f.run, 'core'));
  assert.equal(res[0].status, 'skipped');
  assert.match(res[0].detail, /covered by plugin/);
  assert.equal(res[1].status, 'installed');
  assert.ok(JSON.parse(await read(dir, '.mcp.json')).mcpServers.context7);
});

test('installMcp: default tools unchanged (no extra files)', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner((cmd, args) => (args[0] === 'plugin' ? { stdout: '[]' } : {}));
  const res = await installMcp(await mcpCtx(dir, undefined, f.run, 'core'));
  assert.equal(res.length, 1);
  assert.ok(f.calls.some((c) => c.args[0] === 'mcp'));
  assert.equal(await exists(path.join(dir, '.cursor')), false);
  assert.equal(await exists(path.join(dir, '.codex')), false);
});

test('antigravity: .agents/mcp_config.json with command and args', async () => {
  const dir = await makeTempProject();
  const rows = await writeMcpServers({ tool: 'antigravity', projectDir: dir, servers: [c7], dryRun: false });
  assert.equal(rows[0].status, 'installed');
  assert.deepEqual(JSON.parse(await read(dir, '.agents/mcp_config.json')).mcpServers.context7, { command: 'npx', args: ['-y', '@upstash/context7-mcp'] });
  assert.equal(await exists(path.join(dir, '.gemini')), false, 'Gemini CLI settings are not touched');
});
