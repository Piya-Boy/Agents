# Agent kit

Sub-agents, rules, skills, and MCP servers for Claude Code, installed into your project with one command.

The main agent plans and hands work to specialist agents. Each agent picks the skills it needs on demand, finds current docs for the library versions you use, and replies in your language.

## Requirements
- Node 22.20.0 or newer
- `git` and the `claude` CLI on your PATH
- Internet (skills and MCP servers come from GitHub and npm)

## Install
Run from the root of the project you want to set up:

```bash
node path/to/kit/install.mjs --profile core
```

| Flag | Meaning |
|---|---|
| `--profile core\|web` | `core` (default): general software work. `web` adds the web agents, Chrome DevTools MCP, and the `ui-ux-pro-max` plugin |
| `--dry-run` | Print every action, change nothing |
| `--yes` | Skip the confirmation prompts |
| `--skip-user` | Do not install plugins (they change your whole machine, not just the project) |
| `--only agents,rules,skills,mcp,plugins` | Run only these layers |

The script asks once before installing from third-party sources and lists each one. Without a terminal, pass `--yes`.

## What it installs
| Layer | Where | Source |
|---|---|---|
| Agents | `.claude/agents/` | `kit/agents/core` (+ `kit/agents/web`) |
| Rules | `AGENTS.md`, `CLAUDE.md` | `kit/templates/` (the web section is removed for `core`) |
| Skills | `.claude/skills/`, `skills-lock.json` | repos listed in `kit/kit.json`, plus `software-engineer` bundled in `kit/skills/` |
| MCP servers | `.mcp.json` | `claude mcp add --scope project` |
| Plugins | your user profile | `claude plugin install --scope user` |

What to install is data in `kit/kit.json`. To add a skill repo, MCP server, or plugin, edit that file.

## Safe to re-run
The script skips what already exists and never overwrites your `AGENTS.md`, `CLAUDE.md`, agents, skills, or `.mcp.json` entries. If `AGENTS.md` already exists, merge the kit's rules by hand. An MCP server that an installed plugin already provides (for example `context7`) is skipped.

It never edits `~/.claude/settings.json` or `~/.claude/CLAUDE.md` and installs no hooks.

## After installing
1. Restart Claude Code so plugins load.
2. Run `claude` in the project and approve the project MCP servers when asked.
3. Fill the `TODO` lines in `AGENTS.md` (stack, versions, commands).

## Troubleshooting
- Skills fail with a link error on Windows: the script retries with `--copy` by itself.
- An MCP server shows "Connection closed" on Windows 10: change its `.mcp.json` entry to `"command": "cmd"` with `"args": ["/c", "npx", ...]`. The kit keeps plain `npx` so the file works on every OS.
- Plugin install says it needs a terminal: run the script again in a normal terminal. Claude shows its own approval prompt for plugins.

## Not installed
Hooks, such as the `suggest-compact.js` hook that goes with the `strategic-compact` skill, because they edit `~/.claude/settings.json`.

## Develop
```bash
node --test "kit/test/*.test.mjs"
```
`kit/agents` is a copy of the agent files in the repository root. Edit one, copy to the other.
