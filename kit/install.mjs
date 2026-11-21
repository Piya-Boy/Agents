#!/usr/bin/env node
// Agent kit installer. Node stdlib only. See docs/superpowers/specs/2026-11-21-installer-design.md
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

export async function main() {
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
