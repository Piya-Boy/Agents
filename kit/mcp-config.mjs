// Writes MCP server entries into the project-level config file each tool reads.
// Formats checked against each tool's official docs on 2026-11-21; they change often.
//
//   copilot  .mcp.json              JSON, top-level "mcpServers" (VS Code and Copilot CLI read it)
//   cursor   .cursor/mcp.json       JSON, top-level "mcpServers"
//   gemini   .gemini/settings.json  JSON settings file; servers go under "mcpServers"
//   codex    .codex/config.toml     TOML, one [mcp_servers.<name>] table per server
//
// Claude Code is handled by `claude mcp add` in install.mjs. Nothing here overwrites an entry
// that already exists, and a file that cannot be parsed is left untouched.

import fs from 'node:fs/promises';
import path from 'node:path';

export const MCP_FILES = {
  copilot: '.mcp.json',
  cursor: '.cursor/mcp.json',
  gemini: '.gemini/settings.json',
  codex: '.codex/config.toml',
};

const stripBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);

async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function jsonEntry(tool, def) {
  return tool === 'copilot' ? { type: 'stdio', command: def.command, args: def.args } : { command: def.command, args: def.args };
}

async function writeJson({ tool, rel, file, servers, dryRun }) {
  const row = (name, status, detail) => ({ item: `${name} (${rel})`, status, ...(detail ? { detail } : {}) });
  let obj = {};
  const text = await readIfExists(file);
  if (text !== null && stripBom(text).trim()) {
    try {
      obj = JSON.parse(stripBom(text));
    } catch {
      return servers.map(({ name }) => row(name, 'failed', `${rel} is not valid JSON; left untouched`));
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return servers.map(({ name }) => row(name, 'failed', `${rel} is not a JSON object; left untouched`));
    }
  }
  const existing = obj.mcpServers && typeof obj.mcpServers === 'object' && !Array.isArray(obj.mcpServers) ? obj.mcpServers : {};
  const results = [];
  const add = {};
  for (const { name, def } of servers) {
    if (name in existing) results.push(row(name, 'skipped', 'already configured'));
    else {
      add[name] = jsonEntry(tool, def);
      results.push(row(name, dryRun ? 'dry-run' : 'installed'));
    }
  }
  if (dryRun || !Object.keys(add).length) return results;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const next = { ...obj, mcpServers: { ...existing, ...add } };
    const crlf = text !== null && text.includes('\r\n');
    const out = `${JSON.stringify(next, null, 2)}\n`;
    await fs.writeFile(file, crlf ? out.replace(/\n/g, '\r\n') : out);
  } catch (e) {
    return servers.map(({ name }) => row(name, 'failed', e.message));
  }
  return results;
}

const escapeRegExp = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `[mcp_servers.<name>]` (bare or quoted name), or a sub-table such as `[mcp_servers.<name>.env]`.
function tomlHeader(name) {
  const n = escapeRegExp(name);
  return new RegExp(String.raw`^[ \t]*\[mcp_servers\.(?:${n}|"${n}")(?:\.[^\]]+)?\][ \t]*$`, 'm');
}

async function writeToml({ rel, file, servers, dryRun }) {
  const row = (name, status, detail) => ({ item: `${name} (${rel})`, status, ...(detail ? { detail } : {}) });
  let text;
  try {
    text = await readIfExists(file);
  } catch (e) {
    return servers.map(({ name }) => row(name, 'failed', e.message));
  }
  const current = text === null ? '' : stripBom(text);
  const results = [];
  const blocks = [];
  for (const { name, def } of servers) {
    if (tomlHeader(name).test(current)) {
      results.push(row(name, 'skipped', 'already configured'));
      continue;
    }
    // JSON strings and arrays are valid TOML for these values.
    blocks.push(`[mcp_servers.${name}]\ncommand = ${JSON.stringify(def.command)}\nargs = ${JSON.stringify(def.args)}\n`);
    results.push(row(name, dryRun ? 'dry-run' : 'installed'));
  }
  if (dryRun || !blocks.length) return results;
  try {
    const crlf = current.includes('\r\n');
    const lead = current === '' || /\n\r?\n$/.test(current) ? '' : current.endsWith('\n') ? '\n' : '\n\n';
    const add = `${lead}${blocks.join('\n')}`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, crlf ? add.replace(/\r?\n/g, '\r\n') : add);
  } catch (e) {
    return servers.map(({ name }) => row(name, 'failed', e.message));
  }
  return results;
}

// servers: [{ name, def: { command, args } }]. Returns rows { item, status, detail? } (no layer).
export async function writeMcpServers({ tool, projectDir, servers, dryRun }) {
  const rel = MCP_FILES[tool];
  if (!rel || !servers.length) return [];
  const file = path.join(projectDir, ...rel.split('/'));
  return tool === 'codex' ? writeToml({ rel, file, servers, dryRun }) : writeJson({ tool, rel, file, servers, dryRun });
}
