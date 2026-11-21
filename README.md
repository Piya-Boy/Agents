# Agents

A reusable agent kit for [Claude Code](https://claude.com/claude-code), Codex CLI, Cursor, Gemini CLI, Google Antigravity (`agy`), and GitHub Copilot. The main agent plans and hands work to specialist sub-agents. Each sub-agent picks the skills it needs on demand, checks current docs for the library versions your project uses, and replies in the language you write in.

One Node script installs the whole kit into a project.

## Why

- **Delegation, not one giant context.** The main agent splits work between agents with narrow scopes, so each one starts with a small, focused context.
- **Version-accurate code.** `researcher` reads the locked versions from your repo and checks current docs before any builder agent writes code, so you do not get Next.js 15 code in a Next.js 16 project.
- **Checks before "done".** After a builder agent changes code, `tester` and `reviewer` run on it (and `security-auditor` when the change touches input, auth, or data).
- **Skills on demand.** Agent files only hint at skills. The agent loads one when the task matches, so unused skills cost nothing.
- **Your language.** Replies follow the language you write in. Thai goes through the `thai-natural-writing` skill.

## Self-contained

The kit does not rely on anyone's personal `~/.claude/CLAUDE.md`. Every rule the agents need is written into the `AGENTS.md` the installer creates in your project:

- when to hand work to which agent, and the checks to run before calling a task done
- look up current docs for your library versions before writing code
- git rules: branch names, Conventional Commits, review the diff first, no secrets, no push without your say-so, and no `Co-Authored-By` or "Generated with ..." lines
- keep large raw output (logs, test runs) out of the main context
- when you write Thai, replies go through the `thai-natural-writing` skill

Your own preferences (tone, editor habits, tools the kit does not install) belong in your personal `~/.claude/CLAUDE.md`. Keep those out of the project's `AGENTS.md` so the kit works the same for everyone.

## Quick start

Requirements: Node 22.20.0 or newer, `git`, and the `claude` CLI on your PATH.

Run from the root of your project, no clone needed:

```bash
npx github:Piya-Boy/Agents --dry-run                 # print every action, change nothing
npx github:Piya-Boy/Agents                           # install the core profile
npx github:Piya-Boy/Agents --profile web,superpowers # add the web agents and the superpowers plugin
```

Working from a clone instead: `node path/to/Agents/kit/install.mjs [flags]`.

Then restart your tool, approve the project MCP servers when asked, and fill the `TODO` lines in the generated `AGENTS.md` (stack, versions, commands).

Using another tool? Add `--tool`, for example `npx github:Piya-Boy/Agents --tool codex` or `--tool all`. See [Works with](#works-with).

## Works with

Pick the tools with `--tool` (default `claude`). Each tool gets its files in the place and format it reads.

| Layer | Claude Code | Codex CLI | Cursor | Gemini CLI | GitHub Copilot | Antigravity (`agy`) |
|---|---|---|---|---|---|---|
| Rules | `AGENTS.md` + `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` | `AGENTS.md` + `GEMINI.md` | `AGENTS.md` | `AGENTS.md` |
| Skills | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` |
| Agents | `.claude/agents/*.md` | `.codex/agents/*.toml` | `.cursor/agents/*.md` (skipped when Claude is also selected: Cursor reads `.claude/agents`) | `.gemini/agents/*.md` | `.github/agents/*.agent.md` | `.agents/agents/*.md` |
| MCP servers | `.mcp.json` | `.codex/config.toml` | `.cursor/mcp.json` | `.gemini/settings.json` | `.mcp.json` | `.agents/mcp_config.json` |
| Plugins, hooks | yes | no | no | no | no | no |

What to know:
- **Read-only agents.** `architect`, `reviewer`, `researcher`, `security`, and `security-auditor` are limited to read tools in Claude Code. Only Copilot can express that limit (when every tool maps to a Copilot tool). For the others the agent file says "this agent is read-only" in words. That is an instruction, not enforcement.
- **Models.** The per-agent `model` is dropped for the other tools, which use their own default.
- **Antigravity.** It is Google's replacement for Gemini CLI (`agy`); Gemini CLI now serves mainly enterprise and paid-API users, so `--tool gemini` stays for them. Antigravity reads `AGENTS.md` and `.agents/skills/` but not `.gemini/agents/` or `.gemini/settings.json`, so it has its own files. Its agents get no tools unless you list them, so the kit lists the four tool names its docs name (`view_file`, `grep_search`, `run_command`, `replace_file_content`). The full tool list is not published, so agents that use other tools (web search, MCP) lose them. `--tool agy` is accepted as a short name.
- **Trust.** Codex reads `.codex/config.toml` only in a project you marked as trusted, and Gemini CLI reads `.gemini/settings.json` only in a trusted folder.
- **Formats change.** The file formats were checked against each tool's official docs on 2026-11-21. They live in `kit/convert.mjs` (agents) and `kit/mcp-config.mjs` (MCP). The files were generated and tested, but not opened in the real tools.
- `--tool claude` is the default, so nothing changes for existing Claude Code users.

## Agents

Core profile:

| Agent | Use it for |
|---|---|
| `researcher` | Current API for the version in use, before writing code with a library |
| `architect` | Design and structural decisions before implementation |
| `developer` | Features, fixes, refactors, scripts, CLIs, libraries |
| `backend` | Services, APIs, database, business logic |
| `tester` | Proof that a change works. Never edits app code |
| `qa` | Reproduce a bug, find the root cause, fix, check regressions |
| `reviewer` | Final review of a diff |
| `security-auditor` | Per-change security review |
| `security` | Architecture-level security review |
| `devops` | CI/CD, deploy, release, rollout, monitoring |

The `web` profile adds `designer`, `web-dev`, and `frontend`, plus the Chrome DevTools MCP server and the `ui-ux-pro-max` plugin.

## Profiles

| Profile | Adds |
|---|---|
| `core` | The ten agents above, rules, skills, and the Context7 MCP server. Always included |
| `web` | Web agents, Chrome DevTools MCP, `ui-ux-pro-max` plugin |
| `superpowers` | The `superpowers` plugin (its hook makes the agent check skills before every reply, which uses more context) |
| `all` | Every profile above at once. A profile added to `kit.json` later is included too |

Combine them: `--profile web,superpowers`. Or take everything: `--profile all`.

## Commands

Run all of these from your project root. Working from a clone? Replace `npx github:Piya-Boy/Agents` with `node path/to/Agents/kit/install.mjs`.

### Recipes

| Goal | Command |
|---|---|
| See what would happen, change nothing | `npx github:Piya-Boy/Agents --dry-run` |
| Install the core profile | `npx github:Piya-Boy/Agents` |
| Set up Codex CLI | `npx github:Piya-Boy/Agents --tool codex` |
| Set up Cursor | `npx github:Piya-Boy/Agents --tool cursor` |
| Set up Gemini CLI | `npx github:Piya-Boy/Agents --tool gemini` |
| Set up GitHub Copilot | `npx github:Piya-Boy/Agents --tool copilot` |
| Set up Antigravity | `npx github:Piya-Boy/Agents --tool agy` |
| Set up several tools at once | `npx github:Piya-Boy/Agents --tool claude,codex` (or `--tool all`) |
| Let the kit pick the tools | `npx github:Piya-Boy/Agents --tool auto` |
| Add the web agents, Chrome DevTools MCP, and `ui-ux-pro-max` | `npx github:Piya-Boy/Agents --profile web` |
| Web plus the `superpowers` plugin | `npx github:Piya-Boy/Agents --profile web,superpowers` |
| Every profile (core, web, superpowers) | `npx github:Piya-Boy/Agents --profile all` |
| Project files only, no plugins on your machine | `npx github:Piya-Boy/Agents --skip-user` |
| Skip the confirmation prompts (CI, or no terminal) | `npx github:Piya-Boy/Agents --yes` |
| `AGENTS.md` already exists: add the kit rules at its end | `npx github:Piya-Boy/Agents --only rules --merge-rules` |
| Write MCP servers to `.mcp.json` even if a plugin provides them | `npx github:Piya-Boy/Agents --only mcp --force-mcp` |
| Add only the web MCP server (Chrome DevTools) | `npx github:Piya-Boy/Agents --only mcp --profile web --force-mcp` |
| Get a reminder when installed skills have updates | `npx github:Piya-Boy/Agents --only hooks` (or add `--auto-check` to a full install) |
| Everything, including the opt-in extras | `npx github:Piya-Boy/Agents --profile all --tool all --merge-rules --force-mcp --auto-check` |
| Update installed skills later (after you review) | `npx skills update -p -y` |

### Flags

| Flag | Meaning |
|---|---|
| `--profile NAME[,NAME]` | Profiles to install: `core` (default, always included), `web`, `superpowers`, or `all` for every profile |
| `--dry-run` | Print every action, change nothing |
| `--tool NAME[,NAME]` | Tools to set up: `claude` (default), `codex`, `cursor`, `gemini`, `copilot`, `antigravity` (or `agy`), `all`, or `auto` (picks the tools whose files already exist in the project, such as `.codex/`, `.cursor/`, `GEMINI.md`; `claude` if none; it does not look at your home directory). For the non-Claude tools it writes the rules (`AGENTS.md`, plus `GEMINI.md` for Gemini), the skills (`.agents/skills/`, which all four read), the agents (`.codex/agents/*.toml`, `.cursor/agents/`, `.gemini/agents/`, `.github/agents/*.agent.md`, `.agents/agents/`), and the MCP servers (`.codex/config.toml`, `.cursor/mcp.json`, `.gemini/settings.json`, `.mcp.json`, `.agents/mcp_config.json`). Plugins and hooks are Claude Code only and show as `skipped`. The `claude` CLI is needed only when `claude` is selected |
| `--yes` | Skip the confirmation prompts |
| `--skip-user` | Do not install plugins (they change your whole machine, not just the project) |
| `--only LAYER[,LAYER]` | Run only these layers (see below) |
| `--merge-rules` | If `AGENTS.md` already exists, add the kit rules at its end between `<!-- agent-kit:start -->` and `<!-- agent-kit:end -->`. Your text is not changed, and a re-run adds nothing twice |
| `--force-mcp` | Add the MCP servers to `.mcp.json` even when an installed plugin already provides them (you then get two copies of the tools) |
| `--auto-check` | Add a project hook that tells you when installed skills have updates. It only reports |

### Layers for `--only`

| Layer | What it does | Where it writes |
|---|---|---|
| `agents` | Copies the agent files | `.claude/agents/` |
| `rules` | Creates `AGENTS.md` and `CLAUDE.md` | project root |
| `skills` | Installs the listed skills | `.claude/skills/`, `skills-lock.json` |
| `mcp` | Adds MCP servers | `.mcp.json` |
| `plugins` | Installs plugins | your user profile (`~/.claude/settings.json`) |
| `hooks` | Adds the skill-update check (opt-in) | `.claude/settings.json`, `.claude/hooks/` |

### Re-running

The script is safe to re-run. It skips what already exists and never overwrites your `AGENTS.md`, `CLAUDE.md`, agents, skills, or `.mcp.json` entries. With `--merge-rules` it only adds to the end of an existing `AGENTS.md`. The summary at the end lists every item as `installed`, `skipped` (with the reason), `failed`, or `dry-run`.

Full reference, troubleshooting, and what lands where: [kit/README.md](kit/README.md).

## Repository layout

```
kit/
  install.mjs        the installer (Node stdlib only)
  convert.mjs        turns an agent file into each tool's format
  mcp-config.mjs     writes MCP servers into each tool's config file
  kit.json           what each profile installs: skills, MCP servers, plugins
  agents/            agent files, core/ and web/
  skills/            skills bundled with the kit
  templates/         AGENTS.md, CLAUDE.md, and GEMINI.md copied into projects
  hooks/             opt-in skill-update check
  test/              node:test suite
docs/superpowers/    design specs and implementation plans
```

To add a skill, MCP server, or plugin, edit `kit/kit.json`.

## Development

```bash
node --test "kit/test/*.test.mjs"
```

Work on a branch and use Conventional Commits. The git rules the kit gives to other projects are in [kit/templates/AGENTS.md](kit/templates/AGENTS.md).

## License

[MIT](LICENSE)
