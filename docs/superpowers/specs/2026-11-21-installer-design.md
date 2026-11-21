# Agent kit installer (one Node script) — design (short)

Status: approach chosen and design approved by user 2026-11-21. Updated the same day with `researcher` findings (CLI commands, Windows, Node floor) and the skill sources.
Build status: NOT built.
Builds on: `2026-11-21-core-plus-profiles-design.md`.

## Intent
Other developers download the kit and, from their project root, run one command that installs everything
the agent kit needs: agents, rules files, skills, MCP servers, and plugins. One script file, works on Windows, macOS, Linux.

## Goals
- `node install.mjs --profile core|web` from the target project root.
- What each profile installs is data in `kit.json`, not code. Adding a skill repo or MCP = edit `kit.json`.
- Safe to re-run: skips what is already there, never overwrites user files.
- `--dry-run` prints every action without changing anything.
- Clear end summary: installed / skipped / failed / next steps.

## Non-goals
- Installing prerequisites (`node`, `git`, `claude`). The script checks and says how; it does not install them.
- A Claude Code plugin package; separate PowerShell/bash scripts.
- Updating or uninstalling (later).
- Making `kit/` the single source of truth for the agent files. For now `kit/agents` is a copy of the repo-root files; unifying them is a later task.

## Anti-goals
- Overwriting a user's existing `AGENTS.md`, `CLAUDE.md`, agents, skills, or `.mcp.json` entries.
- Changing user-wide settings (`~/.claude/settings.json`, `~/.claude/CLAUDE.md`) or installing hooks.
- Shipping personal data (local paths, the author's private `~/.claude/CLAUDE.md`).
- Running third-party code without showing its source first.
- Passing `-y` to `claude plugin install` (it accepts a marketplace's commands without asking).

## What gets installed (5 layers)
| # | Layer | Mechanism | Scope |
|---|---|---|---|
| 1 | Agents `.claude/agents/*.md` | copy from `kit/agents/core`, plus `kit/agents/web` for web | project |
| 2 | `AGENTS.md`, `CLAUDE.md` | copy; for `core` remove the `<!-- profile:web:start -->`..`end` block | project |
| 3 | Skills | (a) skills CLI per `{repo, skills}` in `kit.json`; (b) bundled skills copied from `kit/skills/` | project |
| 4 | MCP servers | `claude mcp add --scope project --transport stdio` (writes `.mcp.json`) | project |
| 5 | Plugins | `claude plugin marketplace add` + `claude plugin install` | user (whole machine) |

## Kit layout
```
kit/
  install.mjs        # the script, Node stdlib only; exports functions, runs main() only when executed directly
  kit.json           # profiles -> agents, skills, mcp servers, plugins
  agents/core/*.md   # researcher, architect, developer, backend, tester, qa, reviewer, security-auditor, security, devops
  agents/web/*.md    # designer, web-dev, frontend
  skills/software-engineer/   # bundled: no installable source exists yet
  templates/AGENTS.md, templates/CLAUDE.md
  test/*.test.mjs    # node:test, fake runner, no network
  README.md
```

## `kit.json`
```json
{
  "version": 1,
  "skillsCli": "skills@1.9.0",
  "profiles": {
    "core": {
      "agents": "agents/core",
      "skills": [
        { "repo": "addyosmani/agent-skills", "skills": "*" },
        { "repo": "mattpocock/skills", "skills": "*" },
        { "repo": "Piya-Boy/piya-skill", "skills": ["thai-natural-writing"] },
        { "repo": "GRJY/Claude-Code-skill", "skills": ["strategic-compact"] }
      ],
      "bundledSkills": ["software-engineer"],
      "mcp": ["context7"],
      "plugins": []
    },
    "web": {
      "extends": "core",
      "agents": "agents/web",
      "skills": [{ "repo": "GoogleChrome/modern-web-guidance", "skills": "*" }],
      "mcp": ["chrome-devtools"],
      "plugins": ["ui-ux-pro-max"]
    }
  },
  "mcp": {
    "context7": { "command": "npx", "args": ["-y", "@upstash/context7-mcp"], "coveredByPlugin": "context7@" },
    "chrome-devtools": { "command": "npx", "args": ["-y", "chrome-devtools-mcp@latest"], "coveredByPlugin": "chrome-devtools-mcp@" }
  },
  "plugins": {
    "ui-ux-pro-max": { "marketplace": "nextlevelbuilder/ui-ux-pro-max-skill", "id": "ui-ux-pro-max@ui-ux-pro-max-skill" }
  }
}
```
`extends` merges: agent dirs, skills, bundled skills, mcp, plugins are appended. `skills: "*"` means every skill in that repo.

## Verified commands (researcher, from help output and official docs; nothing was run)
- Skills add: `npx -y skills@PIN add REPO --agent claude-code --skill NAME -y` (`--skill '*'` for all; never `--all`). One call per skill name.
- Skills restore: `npx -y skills@PIN experimental_install --agent claude-code`. Name starts with `experimental_` and may change; not used by the installer in v1.
- Windows link problem: on failure retry once with `--copy`.
- MCP: `claude mcp add --scope project --transport stdio NAME -- CMD ARGS...`. In interactive sessions the user approves project servers on first run; `claude -p` does not ask.
- Plugin: `claude plugin marketplace add REPO --scope user`, then `claude plugin install ID --scope user`. Both re-runnable (exit 0 when present). Detect with `claude plugin list --json` (array of `{id,...}`).
- Context7: package `@upstash/context7-mcp`, no API key needed (a key raises rate limits; never write one into `.mcp.json`).
- Node floor: `>=22.20.0` (set by the skills CLI).

## Behavior
- Preflight: Node `>=22.20.0`, `git`, `claude` on PATH. Missing -> print how to install, exit 1, change nothing.
- Spawning, no shell:
  - Windows `npx`: run `process.execPath` with npm's `npx-cli.js` (found next to `node`). If missing, fall back to `cmd.exe /d /s /c npx ...` and reject args containing any of `& | ^ % " < > CR LF`.
  - `claude`/`git`: search PATH (PATHEXT on Windows); `.exe` runs directly, `.cmd`/`.bat` go through `cmd.exe /d /s /c`.
  - Spawn failure or not found -> that step fails with a clear message.
- Consent: before layers 3-5 list every third-party source (repo / package / marketplace) and ask once. Layer 5 asks separately (changes the whole machine). `--yes` answers both; `--skip-user` skips layer 5. No TTY and no `--yes` -> refuse with a message, exit 1 (never hang).
- Detect-then-skip: agent/skill file exists; skill in `skills-lock.json` with matching `source` or `.claude/skills/NAME` exists; MCP name in `.mcp.json`; MCP covered by an installed plugin (`claude plugin list --json` id starts with `coveredByPlugin`); plugin id in `claude plugin list --json`.
- `.mcp.json`: missing or empty file = `{}`. Non-empty invalid JSON = the MCP layer fails, file left untouched.
- Plugin install runs with inherited stdio so Claude shows its own approval prompt. Not a TTY -> that step fails with "run again in a terminal".
- A failed step does not stop the rest. Exit code 1 if any step failed.
- Existing `AGENTS.md`/`CLAUDE.md`/agent/skill: left untouched, reported as skipped with a warning to merge by hand.
- End summary lists next steps: restart Claude Code (plugins), run `claude` and approve project MCP servers, fill the `TODO` lines in `AGENTS.md`.

## Flags
`--profile core|web` (default core), `--dry-run`, `--yes`, `--skip-user`, `--only agents,rules,skills,mcp,plugins`.

## Approaches considered
1. Node single script + manifest (chosen; user's pick).
2. PowerShell + bash pair: rejected, duplicated logic, still needs Node for skills/MCP.
3. Claude Code plugin only: rejected, cannot install skills from other repos, project MCP, or `AGENTS.md`.

## Decisions by designer (user may override)
- Kit lives in `E:\Develop\agents\kit\` for now.
- Node stdlib only. Tests use `node:test`.
- `.mcp.json` uses plain `npx`, not `cmd /c` (a committed file must work on every OS); `cmd /c` goes in the README troubleshooting.
- Skills CLI pinned in `kit.json`; verify the pin with `npx skills --version` at build time.

## Still unverified (confirm on a real machine during Task 7)
`skills ls --json` schema; `claude mcp get` exit code and duplicate-name behavior; whether the skills CLI falls back to copy on Windows when links fail; Context7 remote HTTP without a key; `claude.cmd` shim when installed via npm.

## Risks
- Third-party CLIs change syntax (`experimental_` commands especially). Pinned versions and the manifest limit the blast radius.
- Skills run as instructions to the agent; trust is the user's choice. The consent prompt shows every source. Pinning repo refs is a later improvement.
- Windows quoting and link behavior; test on Windows (primary) and one POSIX shell.

## Verification plan
- Unit tests with a fake runner: no network, no real installs.
- `--dry-run` on an empty temp project: prints all layers, changes nothing.
- Real run on empty temp projects, `core` and `web`: files present, `.mcp.json` has servers, re-run reports everything skipped.
- Project with an existing `AGENTS.md`: file untouched, warning printed.
- Headless `claude -p` in the installed project: routes a task to the right agent (reuse the routing test).
