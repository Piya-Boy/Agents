#!/usr/bin/env node
// Agent kit installer. Node stdlib only. See docs/superpowers/specs/2026-11-21-installer-design.md
import { spawn } from 'node:child_process';
import { existsSync, realpathSync, constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent, convertAgent } from './convert.mjs';
import { writeMcpServers } from './mcp-config.mjs';

const stripBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);

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
  for (const [pname, def] of Object.entries(manifest.profiles || {})) {
    for (const s of def.skills || []) {
      if (!Array.isArray(s.skills) || !s.skills.length) {
        throw new Error(`kit.json: skills for ${s.repo} in profile ${pname} must be a list of names (no "*": the skills CLI overwrites existing skills)`);
      }
    }
  }
  return manifest;
}

export function resolveProfile(manifest, name, seen = []) {
  const def = manifest.profiles?.[name];
  if (!def) throw new Error(`unknown profile: ${name}`);
  if (seen.includes(name)) throw new Error(`profile extends cycle: ${[...seen, name].join(' -> ')}`);
  const base = def.extends
    ? resolveProfile(manifest, def.extends, [...seen, name])
    : { names: [], agentDirs: [], skills: [], bundledSkills: [], mcp: [], plugins: [] };
  return {
    name,
    names: [...base.names, name],
    agentDirs: [...base.agentDirs, ...(def.agents ? [def.agents] : [])],
    skills: [...base.skills, ...(def.skills || [])],
    bundledSkills: [...base.bundledSkills, ...(def.bundledSkills || [])],
    mcp: [...base.mcp, ...(def.mcp || [])],
    plugins: [...base.plugins, ...(def.plugins || [])],
  };
}

// Combine profiles. `core` always comes first; repeated names and items are dropped.
// `all` stands for every profile in kit.json, so a profile added later is included too.
export function resolveProfiles(manifest, names) {
  const expanded = names.flatMap((n) => (n === 'all' ? Object.keys(manifest.profiles || {}) : [n]));
  const order = ['core', ...expanded.filter((n) => n !== 'core')];
  const out = { name: order.join('+'), names: [], agentDirs: [], skills: [], bundledSkills: [], mcp: [], plugins: [] };
  const addUnique = (list, items) => {
    for (const it of items) if (!list.includes(it)) list.push(it);
  };
  for (const n of order) {
    const p = resolveProfile(manifest, n);
    addUnique(out.names, p.names);
    addUnique(out.agentDirs, p.agentDirs);
    addUnique(out.bundledSkills, p.bundledSkills);
    addUnique(out.mcp, p.mcp);
    addUnique(out.plugins, p.plugins);
    for (const s of p.skills) {
      if (!out.skills.some((x) => x.repo === s.repo && JSON.stringify(x.skills) === JSON.stringify(s.skills))) out.skills.push(s);
    }
  }
  return out;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

export const LAYERS = ['agents', 'rules', 'skills', 'mcp', 'plugins', 'hooks'];
export const TOOLS = ['claude', 'codex', 'cursor', 'gemini', 'copilot'];

const toolsOf = (ctx) => ctx.opts?.tools ?? ['claude'];

export function parseArgs(argv) {
  const o = {
    profiles: ['core'],
    dryRun: false,
    yes: false,
    skipUser: false,
    autoCheck: false,
    mergeRules: false,
    forceMcp: false,
    tools: ['claude'],
    only: null,
    projectDir: process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') {
      o.profiles = String(argv[++i] ?? '').split(',').map((n) => n.trim()).filter(Boolean);
      if (!o.profiles.length) throw new Error('--profile needs a name (for example core, web, or web,superpowers)');
    } else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--yes') o.yes = true;
    else if (a === '--skip-user') o.skipUser = true;
    else if (a === '--auto-check') o.autoCheck = true;
    else if (a === '--merge-rules') o.mergeRules = true;
    else if (a === '--force-mcp') o.forceMcp = true;
    else if (a === '--tool') {
      const names = String(argv[++i] ?? '').split(',').map((n) => n.trim()).filter(Boolean);
      if (!names.length) throw new Error(`--tool needs a name (${TOOLS.join(', ')}, or all)`);
      for (const n of names) if (n !== 'all' && !TOOLS.includes(n)) throw new Error(`--tool: unknown tool ${n} (use ${TOOLS.join(', ')}, or all)`);
      o.tools = names.includes('all') ? [...TOOLS] : TOOLS.filter((t) => names.includes(t));
    }
    else if (a === '--only') {
      const names = String(argv[++i] ?? '').split(',').filter(Boolean);
      for (const n of names) if (!LAYERS.includes(n)) throw new Error(`--only: unknown layer ${n}`);
      o.only = new Set(names);
    } else throw new Error(`unknown flag: ${a}`);
  }
  return o;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
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
    let spawnArgs = [...resolved.prefixArgs, ...args];
    let verbatim = false;
    if (resolved.file === 'cmd.exe') {
      // One verbatim command line: with /s, cmd strips the outer quotes and keeps the rest as typed.
      try {
        const parts = [resolved.prefixArgs[3], ...args];
        assertSafeCmdArgs(parts);
        spawnArgs = ['/d', '/s', '/c', `"${parts.map((x) => `"${x}"`).join(' ')}"`];
        verbatim = true;
      } catch (e) {
        return { code: 1, stdout: '', stderr: e.message };
      }
    }
    const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve) => {
      let out = '';
      let err = '';
      let done = false;
      let timer;
      const finish = (r) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(r);
        }
      };
      let child;
      try {
        child = spawnFn(resolved.file, spawnArgs, {
          cwd: o.cwd,
          stdio: o.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false,
          ...(verbatim ? { windowsVerbatimArguments: true } : {}),
        });
      } catch (e) {
        return finish({ code: 1, stdout: '', stderr: e.message });
      }
      if (!o.inherit) {
        timer = setTimeout(() => {
          try {
            child.kill();
          } catch {}
          finish({ code: 124, stdout: out, stderr: `timed out after ${Math.round(timeoutMs / 1000)}s` });
        }, timeoutMs);
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

// Create-only write of generated content: never overwrites an existing destination.
async function writeNew({ layer, item, dest, content, dryRun, existsDetail }) {
  if (await pathExists(dest)) return { layer, item, status: 'skipped', detail: existsDetail };
  if (dryRun) return { layer, item, status: 'dry-run' };
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content, { flag: 'wx' });
    return { layer, item, status: 'installed' };
  } catch (e) {
    if (e.code === 'EEXIST') return { layer, item, status: 'skipped', detail: existsDetail };
    return { layer, item, status: 'failed', detail: e.message };
  }
}

export async function installAgents(ctx) {
  const results = [];
  const tools = toolsOf(ctx);
  const destDir = path.join(ctx.projectDir, '.claude', 'agents');
  const sources = [];
  for (const dir of ctx.profile.agentDirs) {
    const srcDir = path.join(ctx.kitDir, dir);
    const files = (await fs.readdir(srcDir)).filter((f) => f.endsWith('.md')).sort();
    for (const f of files) sources.push({ f, src: path.join(srcDir, f) });
  }
  if (tools.includes('claude')) {
    for (const { f, src } of sources) {
      results.push(
        await copyNew({
          layer: 'agents',
          item: f,
          src,
          dest: path.join(destDir, f),
          dryRun: ctx.opts.dryRun,
          existsDetail: 'agent exists, left untouched',
        }),
      );
    }
  }
  for (const tool of tools.filter((t) => t !== 'claude')) {
    if (tool === 'cursor' && tools.includes('claude')) {
      // Cursor already reads .claude/agents, so a second copy would only duplicate every agent.
      results.push({ layer: 'agents', item: 'cursor', status: 'skipped', detail: 'Cursor reads .claude/agents' });
      continue;
    }
    for (const { f, src } of sources) {
      try {
        const out = convertAgent(tool, parseAgent(await fs.readFile(src, 'utf8')));
        results.push(
          await writeNew({
            layer: 'agents',
            item: out.path,
            dest: path.join(ctx.projectDir, ...out.path.split('/')),
            content: out.content,
            dryRun: ctx.opts.dryRun,
            existsDetail: 'agent exists, left untouched',
          }),
        );
      } catch (e) {
        results.push({ layer: 'agents', item: `${tool}:${f}`, status: 'failed', detail: e.message });
      }
    }
  }
  return results;
}

export const RULES_START = '<!-- agent-kit:start -->';
export const RULES_END = '<!-- agent-kit:end -->';

// Opt-in (--merge-rules): add the kit rules to the end of an existing AGENTS.md inside markers.
// Never edits existing text, and does nothing if the markers are already there.
async function appendRules({ item, src, dest, dryRun, transform }) {
  let existing;
  try {
    existing = await fs.readFile(dest, 'utf8');
  } catch (e) {
    return { layer: 'rules', item, status: 'failed', detail: e.message };
  }
  if (existing.includes(RULES_START)) return { layer: 'rules', item, status: 'skipped', detail: 'kit rules already added' };
  if (dryRun) return { layer: 'rules', item, status: 'dry-run', detail: 'would add the kit rules at the end' };
  try {
    let body = (await fs.readFile(src, 'utf8')).replace(/\r\n/g, '\n');
    if (transform) body = transform(body);
    // Drop the template title and its "copy this file" intro; keep everything from the first "## " heading.
    body = body.replace(/^# [^\n]*\n[\s\S]*?(?=^## )/m, '').trimEnd();
    const crlf = existing.includes('\r\n');
    const lead = existing.length === 0 || /\n\r?\n$/.test(existing) ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    const block = `${lead}${RULES_START}\n${body}\n${RULES_END}\n`;
    await fs.appendFile(dest, crlf ? block.replace(/\n/g, '\r\n') : block);
    return { layer: 'rules', item, status: 'installed', detail: 'kit rules added at the end of the existing file' };
  } catch (e) {
    return { layer: 'rules', item, status: 'failed', detail: e.message };
  }
}

export async function installRules(ctx) {
  const results = [];
  const tools = toolsOf(ctx);
  const files = ['AGENTS.md', ...(tools.includes('claude') ? ['CLAUDE.md'] : []), ...(tools.includes('gemini') ? ['GEMINI.md'] : [])];
  for (const f of files) {
    const transform =
      f === 'AGENTS.md' && !ctx.profile.names.includes('web') ? (t) => stripProfileBlock(t, 'web') : undefined;
    const src = path.join(ctx.kitDir, 'templates', f);
    const dest = path.join(ctx.projectDir, f);
    if (f === 'AGENTS.md' && ctx.opts.mergeRules && (await pathExists(dest))) {
      results.push(await appendRules({ item: f, src, dest, dryRun: ctx.opts.dryRun, transform }));
      continue;
    }
    results.push(
      await copyNew({
        layer: 'rules',
        item: f,
        src,
        dest,
        dryRun: ctx.opts.dryRun,
        transform,
        existsDetail:
          f === 'AGENTS.md'
            ? 'exists, left untouched: merge the kit rules by hand, or re-run with --merge-rules'
            : 'exists, left untouched: merge the kit rules by hand',
      }),
    );
  }
  return results;
}

const lastLine = (s) => String(s || '').trim().split(/\r?\n/).filter(Boolean).pop() || 'unknown error';

async function readLockSkills(projectDir, log) {
  try {
    const lock = JSON.parse(stripBom(await fs.readFile(path.join(projectDir, 'skills-lock.json'), 'utf8')));
    return lock.skills && typeof lock.skills === 'object' ? lock.skills : {};
  } catch (e) {
    if (e.code !== 'ENOENT') log(`warning: skills-lock.json unreadable (${e.message}); treating as empty`);
    return {};
  }
}

async function installSkillsInto(ctx, { agentId, dirParts, useLock, suffix }) {
  const results = [];
  const dryRun = ctx.opts.dryRun;
  const platform = ctx.platform ?? process.platform;
  const lock = useLock ? await readLockSkills(ctx.projectDir, ctx.log) : {};
  const onDisk = (name) => pathExists(path.join(ctx.projectDir, ...dirParts, name, 'SKILL.md'));

  const addSkill = async (repo, skill, item) => {
    const args = ['-y', ctx.manifest.skillsCli, 'add', repo, '--agent', agentId, '--skill', skill, '-y'];
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
    for (const name of skills) {
      if (lock[name]?.source === repo || (await onDisk(name))) {
        results.push({ layer: 'skills', item: name + suffix, status: 'skipped', detail: 'already installed' });
      } else {
        results.push(await addSkill(repo, name, name + suffix));
      }
    }
  }

  for (const name of ctx.profile.bundledSkills) {
    const dest = path.join(ctx.projectDir, ...dirParts, name);
    if (await pathExists(dest)) {
      results.push({ layer: 'skills', item: name + suffix, status: 'skipped', detail: 'exists, left untouched' });
    } else if (dryRun) {
      results.push({ layer: 'skills', item: name + suffix, status: 'dry-run' });
    } else {
      try {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.cp(path.join(ctx.kitDir, 'skills', name), dest, { recursive: true, errorOnExist: true, force: false });
        results.push({ layer: 'skills', item: name + suffix, status: 'installed' });
      } catch (e) {
        results.push({ layer: 'skills', item: name + suffix, status: 'failed', detail: e.message });
      }
    }
  }
  return results;
}

// Skills CLI agent ids. The CLI writes `.agents/skills/`, which Codex, Cursor, Gemini CLI, and Copilot all read.
const SKILLS_AGENT_IDS = { codex: 'codex', cursor: 'cursor', gemini: 'gemini-cli', copilot: 'github-copilot' };

export async function installSkills(ctx) {
  const tools = toolsOf(ctx);
  const results = [];
  if (tools.includes('claude')) {
    results.push(...(await installSkillsInto(ctx, { agentId: 'claude-code', dirParts: ['.claude', 'skills'], useLock: true, suffix: '' })));
  }
  const other = tools.find((t) => t !== 'claude');
  if (other) {
    // The shared lock file already lists skills installed for Claude, so only the folder decides here.
    results.push(...(await installSkillsInto(ctx, { agentId: SKILLS_AGENT_IDS[other], dirParts: ['.agents', 'skills'], useLock: false, suffix: tools.includes('claude') ? ' (.agents)' : '' })));
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
  text = stripBom(text);
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

async function installMcpClaude(ctx) {
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
    if (covering && !ctx.opts.forceMcp) {
      results.push({ layer: 'mcp', item, status: 'skipped', detail: `covered by plugin ${covering}; use --force-mcp to add it anyway` });
      continue;
    }
    const r = await ctx.run(
      'claude',
      ['mcp', 'add', '--scope', 'project', '--transport', 'stdio', item, '--', def.command, ...def.args],
      { cwd: ctx.projectDir },
    );
    results.push(
      r.code === 0
        ? { layer: 'mcp', item, status: ctx.opts.dryRun ? 'dry-run' : 'installed', ...(covering ? { detail: `plugin ${covering} also provides it` } : {}) }
        : { layer: 'mcp', item, status: 'failed', detail: lastLine(r.stderr) },
    );
  }
  return results;
}

export async function installMcp(ctx) {
  const tools = toolsOf(ctx);
  const results = [];
  if (tools.includes('claude')) results.push(...(await installMcpClaude(ctx)));
  const servers = ctx.profile.mcp.map((name) => ({ name, def: ctx.manifest.mcp[name] }));
  for (const tool of tools.filter((t) => t !== 'claude')) {
    const rows = await writeMcpServers({ tool, projectDir: ctx.projectDir, servers, dryRun: ctx.opts.dryRun });
    results.push(...rows.map((r) => ({ layer: 'mcp', ...r })));
  }
  return results;
}

const AUTO_CHECK_SCRIPT = 'check-skills.mjs';

// Exec form (command + args): no shell, so it works the same on Windows, macOS, and Linux.
function autoCheckHook(cli) {
  return {
    type: 'command',
    command: 'node',
    args: [`\${CLAUDE_PROJECT_DIR}/.claude/hooks/${AUTO_CHECK_SCRIPT}`, cli],
    timeout: 30,
  };
}

// Opt-in (--auto-check): a SessionStart hook that only tells the user when skills have updates.
export async function installAutoCheck(ctx) {
  const dryRun = ctx.opts.dryRun;
  const results = [];
  results.push(
    await copyNew({
      layer: 'hooks',
      item: AUTO_CHECK_SCRIPT,
      src: path.join(ctx.kitDir, 'hooks', AUTO_CHECK_SCRIPT),
      dest: path.join(ctx.projectDir, '.claude', 'hooks', AUTO_CHECK_SCRIPT),
      dryRun,
    }),
  );
  const item = 'settings.json (SessionStart hook)';
  const file = path.join(ctx.projectDir, '.claude', 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(stripBom(await fs.readFile(file, 'utf8')));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('not an object');
  } catch (e) {
    if (e.code !== 'ENOENT') {
      results.push({ layer: 'hooks', item, status: 'failed', detail: '.claude/settings.json is not valid JSON; left untouched' });
      return results;
    }
    settings = {};
  }
  const existing = (settings.hooks?.SessionStart || []).flatMap((e) => e.hooks || []);
  const isOurs = (h) =>
    (typeof h.command === 'string' && h.command.includes(AUTO_CHECK_SCRIPT)) ||
    (Array.isArray(h.args) && h.args.some((a) => String(a).includes(AUTO_CHECK_SCRIPT)));
  if (existing.some(isOurs)) {
    results.push({ layer: 'hooks', item, status: 'skipped', detail: 'hook already present' });
    return results;
  }
  if (dryRun) {
    results.push({ layer: 'hooks', item, status: 'dry-run' });
    return results;
  }
  try {
    settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
    settings.hooks.SessionStart = [
      ...(settings.hooks.SessionStart || []),
      { matcher: 'startup', hooks: [autoCheckHook(ctx.manifest.skillsCli)] },
    ];
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(settings, null, 2) + String.fromCharCode(10));
    results.push({ layer: 'hooks', item, status: 'installed' });
  } catch (e) {
    results.push({ layer: 'hooks', item, status: 'failed', detail: e.message });
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

export function preflight(env, tools = ['claude']) {
  const problems = [];
  const have = String(env.nodeVersion).split('.').map((n) => parseInt(n, 10) || 0);
  let cmp = 0;
  for (let i = 0; i < 3 && cmp === 0; i++) cmp = Math.sign((have[i] ?? 0) - NODE_FLOOR[i]);
  if (cmp < 0) problems.push(`node 22.20.0 or newer required (found ${env.nodeVersion})`);
  for (const name of ['git', ...(tools.includes('claude') ? ['claude'] : [])]) if (!env.resolve(name)) problems.push(`${name} not found on PATH`);
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

export function formatSummary(results, tools = ['claude']) {
  const out = [];
  for (const layer of LAYERS) {
    const rows = results.filter((r) => r.layer === layer);
    if (!rows.length) continue;
    out.push(`[${layer}]`);
    for (const r of rows) out.push(`  ${r.status.padEnd(9)} ${r.item}${r.detail ? ` (${r.detail})` : ''}`);
  }
  const n = (s) => results.filter((r) => r.status === s).length;
  out.push('', `installed ${n('installed')}, skipped ${n('skipped')}, failed ${n('failed')}${n('dry-run') ? `, dry-run ${n('dry-run')}` : ''}`);
  const steps = [
    ...(tools.includes('claude')
      ? ['Restart Claude Code (plugins load on start).', 'Run `claude` in this project and approve the project MCP servers when asked.']
      : []),
    ...(tools.includes('codex') ? ['Codex reads `.codex/config.toml` (MCP servers) only in a project you have marked as trusted.'] : []),
    ...(tools.includes('gemini') ? ['Gemini CLI reads `.gemini/settings.json` (MCP servers) only in a trusted folder.'] : []),
    'Fill the TODO lines in AGENTS.md.',
  ];
  out.push('', 'Next steps:', ...steps.map((t, i) => `  ${i + 1}. ${t}`));
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

    const pre = preflight(env, opts.tools);
    if (!pre.ok) {
      for (const p of pre.problems) log(`error: ${p}`);
      return 1;
    }
    const manifest = await loadManifest(kitDir);
    const profile = resolveProfiles(manifest, opts.profiles);
    const run = deps.run ?? createRunner({ dryRun: opts.dryRun, log, spawnFn: deps.spawnFn, env: cmdEnv });
    const selected = (l) => !opts.only || opts.only.has(l);
    const hasClaude = opts.tools.includes('claude');
    const others = opts.tools.filter((t) => t !== 'claude').join(',');
    const ctx = { kitDir, projectDir: opts.projectDir, manifest, profile, run, opts, isTTY, log };

    const needsConsent = new Set(['skills', 'mcp']).intersection(opts.only ?? new Set(['skills', 'mcp']));
    if (!opts.dryRun && needsConsent.size) {
      const lines = listSources(profile, manifest, needsConsent);
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
    // Plugins and hooks exist only for Claude Code; other tools get a visible "skipped" row.
    const claudeOnly = (layer) => results.push({ layer, item: others, status: 'skipped', detail: 'Claude Code only' });
    if (selected('agents')) results.push(...(await installAgents(ctx)));
    if (selected('rules')) results.push(...(await installRules(ctx)));
    if (selected('skills')) results.push(...(await installSkills(ctx)));
    if (selected('mcp') && profile.mcp.length) results.push(...(await installMcp(ctx)));
    if (opts.autoCheck || opts.only?.has('hooks')) {
      if (hasClaude) results.push(...(await installAutoCheck(ctx)));
      else claudeOnly('hooks');
    }
    if (selected('plugins') && profile.plugins.length && !hasClaude) claudeOnly('plugins');
    else if (selected('plugins') && profile.plugins.length) {
      if (opts.skipUser) {
        results.push(...profile.plugins.map((item) => ({ layer: 'plugins', item, status: 'skipped', detail: '--skip-user' })));
      } else {
        let go = true;
        if (!opts.dryRun) {
          log('Plugins install for the whole machine (user scope). Claude will add them to ~/.claude/settings.json (enabledPlugins, extraKnownMarketplaces):');
          for (const l of listSources(profile, manifest, new Set(['plugins']))) log(`  ${l}`);
          go = await confirm('Install plugins?', { yes: opts.yes, isTTY, ask });
        }
        if (go) results.push(...(await installPlugins(ctx)));
        else results.push(...profile.plugins.map((item) => ({ layer: 'plugins', item, status: 'skipped', detail: 'declined' })));
      }
    }
    log(formatSummary(results, opts.tools));
    return results.some((r) => r.status === 'failed') ? 1 : 0;
  } catch (e) {
    log(`error: ${e.message}`);
    return 1;
  }
}

if (isEntryPoint()) {
  process.exit(await main(process.argv.slice(2)));
}
