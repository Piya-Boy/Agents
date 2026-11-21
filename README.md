# Agents

A reusable agent kit for [Claude Code](https://claude.com/claude-code). The main agent plans and hands work to specialist sub-agents. Each sub-agent picks the skills it needs on demand, checks current docs for the library versions your project uses, and replies in the language you write in.

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

Then restart Claude Code, approve the project MCP servers when asked, and fill the `TODO` lines in the generated `AGENTS.md` (stack, versions, commands).

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

Combine them: `--profile web,superpowers`.

## Useful flags

| Flag | Meaning |
|---|---|
| `--profile NAME[,NAME]` | Profiles to install |
| `--dry-run` | Print every action, change nothing |
| `--yes` | Skip the confirmation prompts |
| `--skip-user` | Do not install plugins (they change your whole machine, not just the project) |
| `--only agents,rules,skills,mcp,plugins,hooks` | Run only these layers |
| `--merge-rules` | If `AGENTS.md` already exists, add the kit rules at its end between `<!-- agent-kit:start -->` and `<!-- agent-kit:end -->`. Your text is not changed, and a re-run adds nothing twice |
| `--auto-check` | Add a project hook that tells you when installed skills have updates. It only reports |

The script is safe to re-run. It skips what already exists and never overwrites your `AGENTS.md`, `CLAUDE.md`, agents, skills, or `.mcp.json` entries. With `--merge-rules` it only adds to the end of an existing `AGENTS.md`.

Full reference, troubleshooting, and what lands where: [kit/README.md](kit/README.md).

## Repository layout

```
kit/
  install.mjs        the installer (Node stdlib only)
  kit.json           what each profile installs: skills, MCP servers, plugins
  agents/            agent files, core/ and web/
  skills/            skills bundled with the kit
  templates/         AGENTS.md and CLAUDE.md copied into projects
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
