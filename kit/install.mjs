#!/usr/bin/env node
// Agent kit installer. Node stdlib only. See docs/superpowers/specs/2026-11-21-installer-design.md
import { spawn } from 'node:child_process';
import { existsSync, constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function loadManifest(kitDir) {
  let text;
  try {
    text = await fs.readFile(path.join(kitDir, 'kit.json'), 'utf8');
  } catch (e) {
    throw new Error(`kit.json: cannot read (${e.code || e.message})`);
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (e) {
    throw new Error(`kit.json: invalid JSON (${e.message})`);
  }
  if (manifest.version !== 1) throw new Error('kit.json: unsupported version');
  return manifest;
}

export function resolveProfile(manifest, name, seen = []) {
  const def = manifest.profiles?.[name];
  if (!def) throw new Error(`unknown profile: ${name}`);
  if (seen.includes(name)) throw new Error(`profile extends cycle: ${[...seen, name].join(' -> ')}`);
  const base = def.extends
    ? resolveProfile(manifest, def.extends, [...seen, name])
    : { agentDirs: [], skills: [], bundledSkills: [], mcp: [], plugins: [] };
  return {
    name,
    agentDirs: [...base.agentDirs, ...(def.agents ? [def.agents] : [])],
    skills: [...base.skills, ...(def.skills || [])],
    bundledSkills: [...base.bundledSkills, ...(def.bundledSkills || [])],
    mcp: [...base.mcp, ...(def.mcp || [])],
    plugins: [...base.plugins, ...(def.plugins || [])],
  };
}

export const LAYERS = ['agents', 'rules', 'skills', 'mcp', 'plugins'];

export function parseArgs(argv) {
  const o = {
    profile: 'core',
    dryRun: false,
    yes: false,
    skipUser: false,
    only: null,
    projectDir: process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') {
      o.profile = argv[++i];
      if (o.profile !== 'core' && o.profile !== 'web') throw new Error('--profile must be core or web');
    } else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--yes') o.yes = true;
    else if (a === '--skip-user') o.skipUser = true;
    else if (a === '--only') {
      const names = String(argv[++i] ?? '').split(',').filter(Boolean);
      for (const n of names) if (!LAYERS.includes(n)) throw new Error(`--only: unknown layer ${n}`);
      o.only = new Set(names);
    } else throw new Error(`unknown flag: ${a}`);
  }
  return o;
}

const UNSAFE_CMD_ARG = /[&|^%"<>\r\n]/;

export function assertSafeCmdArgs(args) {
  for (const a of args) {
    if (UNSAFE_CMD_ARG.test(a)) throw new Error(`unsafe argument for cmd.exe: ${a}`);
  }
}

export function defaultEnv() {
  return {
    platform: process.platform,
    pathEnv: process.env.PATH || process.env.Path || '',
    pathExt: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
    execPath: process.execPath,
    exists: (p) => existsSync(p),
  };
}

export function resolveCommand(name, env) {
  const isWin = env.platform === 'win32';
  const p = isWin ? path.win32 : path.posix;
  if (isWin && name === 'npx') {
    const cli = p.join(p.dirname(env.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (env.exists(cli)) return { file: env.execPath, prefixArgs: [cli] };
    return { file: 'cmd.exe', prefixArgs: ['/d', '/s', '/c', 'npx'] };
  }
  const dirs = env.pathEnv.split(isWin ? ';' : ':').filter(Boolean);
  const exts = isWin ? env.pathExt.split(';').filter(Boolean).map((e) => e.toLowerCase()) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = p.join(dir, name + ext);
      if (!env.exists(full)) continue;
      if (isWin && /\.(cmd|bat)$/i.test(full)) return { file: 'cmd.exe', prefixArgs: ['/d', '/s', '/c', full] };
      return { file: full, prefixArgs: [] };
    }
  }
  return null;
}

export function createRunner({ dryRun, log, spawnFn = spawn, env = defaultEnv() }) {
  return async function run(cmd, args, o = {}) {
    if (dryRun && !o.readOnly) {
      log(`[dry-run] ${cmd} ${args.join(' ')}`);
      return { code: 0, stdout: '', stderr: '' };
    }
    const resolved = resolveCommand(cmd, env);
    if (!resolved) return { code: 127, stdout: '', stderr: `command not found: ${cmd}` };
    try {
      if (resolved.file === 'cmd.exe') assertSafeCmdArgs(args);
    } catch (e) {
      return { code: 1, stdout: '', stderr: e.message };
    }
    return new Promise((resolve) => {
      let out = '';
      let err = '';
      let done = false;
      const finish = (r) => {
        if (!done) {
          done = true;
          resolve(r);
        }
      };
      let child;
      try {
        child = spawnFn(resolved.file, [...resolved.prefixArgs, ...args], {
          cwd: o.cwd,
          stdio: o.inherit ? 'inherit' : 'pipe',
          windowsHide: true,
          shell: false,
        });
      } catch (e) {
        return finish({ code: 1, stdout: '', stderr: e.message });
      }
      child.stdout?.on('data', (d) => (out += d));
      child.stderr?.on('data', (d) => (err += d));
      child.on('error', (e) => finish({ code: 1, stdout: '', stderr: e.message }));
      child.on('close', (code) => finish({ code: code ?? 1, stdout: out, stderr: err }));
    });
  };
}

export function stripProfileBlock(text, name) {
  const start = `<!-- profile:${name}:start -->`;
  const end = `<!-- profile:${name}:end -->`;
  const lines = text.split(/(?<=\n)/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    const t = line.trim();
    if (t === start) skipping = true;
    else if (skipping && t === end) skipping = false;
    else if (!skipping) out.push(line);
  }
  return out.join('');
}

const pathExists = (p) => fs.access(p).then(() => true, () => false);

// Create-only copy: never overwrites an existing destination.
async function copyNew({ layer, item, src, dest, dryRun, transform, existsDetail = 'already exists, left untouched' }) {
  if (await pathExists(dest)) return { layer, item, status: 'skipped', detail: existsDetail };
  if (dryRun) return { layer, item, status: 'dry-run' };
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (transform) {
      const text = await fs.readFile(src, 'utf8');
      await fs.writeFile(dest, transform(text), { flag: 'wx' });
    } else {
      await fs.copyFile(src, dest, fsConstants.COPYFILE_EXCL);
    }
    return { layer, item, status: 'installed' };
  } catch (e) {
    if (e.code === 'EEXIST') return { layer, item, status: 'skipped', detail: existsDetail };
    return { layer, item, status: 'failed', detail: e.message };
  }
}

export async function installAgents(ctx) {
  const results = [];
  const destDir = path.join(ctx.projectDir, '.claude', 'agents');
  for (const dir of ctx.profile.agentDirs) {
    const srcDir = path.join(ctx.kitDir, dir);
    const files = (await fs.readdir(srcDir)).filter((f) => f.endsWith('.md')).sort();
    for (const f of files) {
      results.push(
        await copyNew({
          layer: 'agents',
          item: f,
          src: path.join(srcDir, f),
          dest: path.join(destDir, f),
          dryRun: ctx.opts.dryRun,
          existsDetail: 'agent exists, left untouched',
        }),
      );
    }
  }
  return results;
}

export async function installRules(ctx) {
  const results = [];
  const mergeNote = 'exists, left untouched: merge the kit rules by hand';
  for (const f of ['AGENTS.md', 'CLAUDE.md']) {
    const transform =
      f === 'AGENTS.md' && ctx.profile.name === 'core' ? (t) => stripProfileBlock(t, 'web') : undefined;
    results.push(
      await copyNew({
        layer: 'rules',
        item: f,
        src: path.join(ctx.kitDir, 'templates', f),
        dest: path.join(ctx.projectDir, f),
        dryRun: ctx.opts.dryRun,
        transform,
        existsDetail: mergeNote,
      }),
    );
  }
  return results;
}

const lastLine = (s) => String(s || '').trim().split(/\r?\n/).filter(Boolean).pop() || 'unknown error';

async function readLockSkills(projectDir, log) {
  try {
    const lock = JSON.parse(await fs.readFile(path.join(projectDir, 'skills-lock.json'), 'utf8'));
    return lock.skills && typeof lock.skills === 'object' ? lock.skills : {};
  } catch (e) {
    if (e.code !== 'ENOENT') log(`warning: skills-lock.json unreadable (${e.message}); treating as empty`);
    return {};
  }
}

export async function installSkills(ctx) {
  const results = [];
  const dryRun = ctx.opts.dryRun;
  const platform = ctx.platform ?? process.platform;
  const lock = await readLockSkills(ctx.projectDir, ctx.log);
  const onDisk = (name) => pathExists(path.join(ctx.projectDir, '.claude', 'skills', name, 'SKILL.md'));

  const addSkill = async (repo, skill, item) => {
    const args = ['-y', ctx.manifest.skillsCli, 'add', repo, '--agent', 'claude-code', '--skill', skill, '-y'];
    let r = await ctx.run('npx', args, { cwd: ctx.projectDir });
    let detail;
    if (r.code !== 0 && platform === 'win32') {
      r = await ctx.run('npx', [...args, '--copy'], { cwd: ctx.projectDir });
      if (r.code === 0) detail = 'copy fallback';
    }
    if (r.code !== 0) return { layer: 'skills', item, status: 'failed', detail: lastLine(r.stderr) };
    return { layer: 'skills', item, status: dryRun ? 'dry-run' : 'installed', ...(detail ? { detail } : {}) };
  };

  for (const { repo, skills } of ctx.profile.skills) {
    if (skills === '*') {
      const have = Object.values(lock).some((e) => e && e.source === repo);
      results.push(
        have
          ? { layer: 'skills', item: `${repo} (all)`, status: 'skipped', detail: 'already in skills-lock.json' }
          : await addSkill(repo, '*', `${repo} (all)`),
      );
      continue;
    }
    for (const name of skills) {
      if (lock[name]?.source === repo || (await onDisk(name))) {
        results.push({ layer: 'skills', item: name, status: 'skipped', detail: 'already installed' });
      } else {
        results.push(await addSkill(repo, name, name));
      }
    }
  }

  for (const name of ctx.profile.bundledSkills) {
    const dest = path.join(ctx.projectDir, '.claude', 'skills', name);
    if (await pathExists(dest)) {
      results.push({ layer: 'skills', item: name, status: 'skipped', detail: 'exists, left untouched' });
    } else if (dryRun) {
      results.push({ layer: 'skills', item: name, status: 'dry-run' });
    } else {
      try {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.cp(path.join(ctx.kitDir, 'skills', name), dest, { recursive: true, errorOnExist: true, force: false });
        results.push({ layer: 'skills', item: name, status: 'installed' });
      } catch (e) {
        results.push({ layer: 'skills', item: name, status: 'failed', detail: e.message });
      }
    }
  }
  return results;
}

export async function readMcpJson(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { mcpServers: {} };
    throw e;
  }
  if (!text.trim()) return { mcpServers: {} };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('.mcp.json is not valid JSON');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('.mcp.json is not valid JSON');
  return { ...obj, mcpServers: obj.mcpServers && typeof obj.mcpServers === 'object' ? obj.mcpServers : {} };
}

export async function listInstalledPluginIds(run, cwd) {
  const r = await run('claude', ['plugin', 'list', '--json'], { cwd, readOnly: true });
  if (r.code !== 0) return [];
  try {
    const arr = JSON.parse(r.stdout);
    return Array.isArray(arr) ? arr.map((p) => p && p.id).filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function installMcp(ctx) {
  const names = ctx.profile.mcp;
  if (!names.length) return [];
  let servers;
  try {
    servers = (await readMcpJson(path.join(ctx.projectDir, '.mcp.json'))).mcpServers;
  } catch (e) {
    return names.map((item) => ({ layer: 'mcp', item, status: 'failed', detail: e.message }));
  }
  const pluginIds = await listInstalledPluginIds(ctx.run, ctx.projectDir);
  const results = [];
  for (const item of names) {
    const def = ctx.manifest.mcp[item];
    if (item in servers) {
      results.push({ layer: 'mcp', item, status: 'skipped', detail: 'already in .mcp.json' });
      continue;
    }
    const covering = def.coveredByPlugin && pluginIds.find((id) => id.startsWith(def.coveredByPlugin));
    if (covering) {
      results.push({ layer: 'mcp', item, status: 'skipped', detail: `covered by plugin ${covering}` });
      continue;
    }
    const r = await ctx.run(
      'claude',
      ['mcp', 'add', '--scope', 'project', '--transport', 'stdio', item, '--', def.command, ...def.args],
      { cwd: ctx.projectDir },
    );
    results.push(
      r.code === 0
        ? { layer: 'mcp', item, status: ctx.opts.dryRun ? 'dry-run' : 'installed' }
        : { layer: 'mcp', item, status: 'failed', detail: lastLine(r.stderr) },
    );
  }
  return results;
}

export async function installPlugins(ctx) {
  const names = ctx.profile.plugins;
  if (!names.length) return [];
  const dryRun = ctx.opts.dryRun;
  const isTTY = ctx.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const installed = await listInstalledPluginIds(ctx.run, ctx.projectDir);
  const results = [];
  for (const item of names) {
    const def = ctx.manifest.plugins[item];
    if (installed.includes(def.id)) {
      results.push({ layer: 'plugins', item, status: 'skipped', detail: 'already installed' });
      continue;
    }
    if (!isTTY && !dryRun) {
      results.push({ layer: 'plugins', item, status: 'failed', detail: 'needs a terminal for approval; run again in a terminal' });
      continue;
    }
    const add = await ctx.run('claude', ['plugin', 'marketplace', 'add', def.marketplace, '--scope', 'user'], { cwd: ctx.projectDir });
    if (add.code !== 0) {
      results.push({ layer: 'plugins', item, status: 'failed', detail: `marketplace: ${lastLine(add.stderr)}` });
      continue;
    }
    // No -y: Claude shows its own approval prompt for marketplace commands.
    const inst = await ctx.run('claude', ['plugin', 'install', def.id, '--scope', 'user'], { cwd: ctx.projectDir, inherit: true });
    results.push(
      inst.code === 0
        ? { layer: 'plugins', item, status: dryRun ? 'dry-run' : 'installed' }
        : { layer: 'plugins', item, status: 'failed', detail: lastLine(inst.stderr) || `exit ${inst.code}` },
    );
  }
  return results;
}

const NODE_FLOOR = [22, 20, 0];

export function preflight(env) {
  const problems = [];
  const have = String(env.nodeVersion).split('.').map((n) => parseInt(n, 10) || 0);
  let cmp = 0;
  for (let i = 0; i < 3 && cmp === 0; i++) cmp = Math.sign((have[i] ?? 0) - NODE_FLOOR[i]);
  if (cmp < 0) problems.push(`node 22.20.0 or newer required (found ${env.nodeVersion})`);
  for (const name of ['git', 'claude']) if (!env.resolve(name)) problems.push(`${name} not found on PATH`);
  return { ok: problems.length === 0, problems };
}

export async function confirm(question, { yes, isTTY, ask }) {
  if (yes) return true;
  if (!isTTY) throw new Error('non-interactive: pass --yes to continue');
  const answer = String(await ask(`${question} [y/N] `)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

export function listSources(profile, manifest, layers) {
  const want = (l) => !layers || layers.has(l);
  const lines = [];
  if (want('skills')) for (const s of profile.skills) lines.push(`skills: ${s.repo}`);
  if (want('mcp')) {
    for (const n of profile.mcp) {
      const d = manifest.mcp[n];
      lines.push(`mcp: ${[d.command, ...d.args.filter((a) => a !== '-y')].join(' ')}`);
    }
  }
  if (want('plugins')) for (const n of profile.plugins) lines.push(`plugin: ${manifest.plugins[n].marketplace}`);
  return lines;
}

export function formatSummary(results) {
  const out = [];
  for (const layer of LAYERS) {
    const rows = results.filter((r) => r.layer === layer);
    if (!rows.length) continue;
    out.push(`[${layer}]`);
    for (const r of rows) out.push(`  ${r.status.padEnd(9)} ${r.item}${r.detail ? ` (${r.detail})` : ''}`);
  }
  const n = (s) => results.filter((r) => r.status === s).length;
  out.push('', `installed ${n('installed')}, skipped ${n('skipped')}, failed ${n('failed')}${n('dry-run') ? `, dry-run ${n('dry-run')}` : ''}`);
  out.push(
    '',
    'Next steps:',
    '  1. Restart Claude Code (plugins load on start).',
    '  2. Run `claude` in this project and approve the project MCP servers when asked.',
    '  3. Fill the TODO lines in AGENTS.md.',
  );
  return out.join('\n');
}

async function defaultAsk(question) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function main(argv, deps = {}) {
  const log = deps.log ?? ((l) => console.log(l));
  try {
    const opts = parseArgs(argv);
    if (deps.projectDir) opts.projectDir = deps.projectDir;
    const kitDir = deps.kitDir ?? path.dirname(fileURLToPath(import.meta.url));
    const cmdEnv = deps.cmdEnv ?? defaultEnv();
    const env = deps.env ?? { nodeVersion: process.versions.node, resolve: (n) => resolveCommand(n, cmdEnv) };
    const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const ask = deps.ask ?? defaultAsk;

    const pre = preflight(env);
    if (!pre.ok) {
      for (const p of pre.problems) log(`error: ${p}`);
      return 1;
    }
    const manifest = await loadManifest(kitDir);
    const profile = resolveProfile(manifest, opts.profile);
    const run = deps.run ?? createRunner({ dryRun: opts.dryRun, log, spawnFn: deps.spawnFn, env: cmdEnv });
    const selected = (l) => !opts.only || opts.only.has(l);
    const ctx = { kitDir, projectDir: opts.projectDir, manifest, profile, run, opts, isTTY, log };

    if (!opts.dryRun && (selected('skills') || selected('mcp'))) {
      const lines = listSources(profile, manifest, new Set(['skills', 'mcp']).intersection(opts.only ?? new Set(['skills', 'mcp'])));
      if (lines.length) {
        log('Third-party sources this run will install from:');
        for (const l of lines) log(`  ${l}`);
        if (!(await confirm('Continue?', { yes: opts.yes, isTTY, ask }))) {
          log('Cancelled. Nothing was changed.');
          return 1;
        }
      }
    }

    const results = [];
    if (selected('agents')) results.push(...(await installAgents(ctx)));
    if (selected('rules')) results.push(...(await installRules(ctx)));
    if (selected('skills')) results.push(...(await installSkills(ctx)));
    if (selected('mcp')) results.push(...(await installMcp(ctx)));
    if (selected('plugins') && profile.plugins.length) {
      if (opts.skipUser) {
        results.push(...profile.plugins.map((item) => ({ layer: 'plugins', item, status: 'skipped', detail: '--skip-user' })));
      } else {
        let go = true;
        if (!opts.dryRun) {
          log('Plugins install for the whole machine (user scope):');
          for (const l of listSources(profile, manifest, new Set(['plugins']))) log(`  ${l}`);
          go = await confirm('Install plugins?', { yes: opts.yes, isTTY, ask });
        }
        if (go) results.push(...(await installPlugins(ctx)));
        else results.push(...profile.plugins.map((item) => ({ layer: 'plugins', item, status: 'skipped', detail: 'declined' })));
      }
    }
    log(formatSummary(results));
    return results.some((r) => r.status === 'failed') ? 1 : 0;
  } catch (e) {
    log(`error: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
