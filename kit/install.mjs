#!/usr/bin/env node
// Agent kit installer. Node stdlib only. See docs/superpowers/specs/2026-11-21-installer-design.md
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

export async function main() {
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
