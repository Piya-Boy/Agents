#!/usr/bin/env node
// SessionStart hook: tell the user when installed skills have updates. Never updates anything itself.
// Usage: node check-skills.mjs <skills-cli-package, e.g. skills@1.9.0>
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 60 * 1000;

export function parseCheckOutput(text) {
  const clean = String(text || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  const names = [];
  for (const line of clean.split(/\r?\n/)) {
    const m = /^\s*↑\s+(\S+)\s+has an update/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

export function formatNotice(names) {
  if (!names.length) return null;
  return `Skill updates available: ${names.join(', ')}. Review, then run: npx skills update -p -y`;
}

export async function shouldRun(stateFile, now, intervalMs) {
  try {
    const { lastCheck } = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    return !(typeof lastCheck === 'number' && now - lastCheck < intervalMs);
  } catch {
    return true;
  }
}

function npxCommand() {
  if (process.platform !== 'win32') return { file: 'npx', prefix: [] };
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (existsSync(cli)) return { file: process.execPath, prefix: [cli] };
  return { file: 'cmd.exe', prefix: ['/d', '/s', '/c', 'npx'] };
}

export function defaultRunCheck(projectDir, cli) {
  return new Promise((resolve, reject) => {
    const { file, prefix } = npxCommand();
    const child = spawn(file, [...prefix, '-y', cli, 'check'], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      env: { ...process.env, DISABLE_TELEMETRY: '1' },
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timed out'));
    }, CHECK_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: out, stderr: '' });
    });
  });
}

export function stateFileFor(projectDir) {
  const id = createHash('sha1').update(path.resolve(projectDir)).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `agent-kit-skills-check-${id}.json`);
}

export async function checkSkills(deps) {
  const { projectDir, cli, stateFile, intervalMs = DAY_MS, now = Date.now, runCheck = defaultRunCheck } = deps;
  try {
    await fs.access(path.join(projectDir, 'skills-lock.json'));
    if (!(await shouldRun(stateFile, now(), intervalMs))) return { message: null };
    const r = await runCheck(projectDir, cli);
    await fs.writeFile(stateFile, JSON.stringify({ lastCheck: now() }));
    return { message: formatNotice(parseCheckOutput(r.stdout)) };
  } catch {
    return { message: null };
  }
}

function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const cli = process.argv[2] || 'skills';
  const { message } = await checkSkills({ projectDir, cli, stateFile: stateFileFor(projectDir) });
  if (message) process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
}
