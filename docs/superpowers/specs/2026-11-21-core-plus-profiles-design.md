# Agent kit: core + profiles — design (short)

Status: approved by user in conversation 2026-11-21 ("ตกลง เขียนเอกสารออกแบบเลย").
Build status: NOT built. Files are changed only after a separate go from the user.
Builds on: `2026-11-21-skill-routing-subagents-design.md`, `2026-11-21-designer-agent-design.md`.

## Intent
The kit is for software developers in general, not only web work. Today it leans to web:
`web-dev`, `designer`, a `tester` that opens a browser, and an `AGENTS.md` whose workflow starts at UI.
Make a language-agnostic core, plus optional profiles for specific kinds of work. Quality first,
then packaging so other people can install it (packaging is a later, separate design).

## Goals
- Core roster works for any language and project type.
- Web becomes a profile that can be installed or skipped.
- `AGENTS.md` template split into core part + profile part.
- Install lets the user pick a profile: `core` or `core + web`.
- Other profiles (mobile, data/AI, ...) can be added later without touching core.

## Non-goals
- No per-language agents.
- No change to `web-dev` into a general coder (name would mislead; web guidance would load for every task).
- No packaging, install script, or plugin work yet.
- No new profiles besides web now.

## Anti-goals
- Core agents that mention web, a browser, or a framework as a requirement.
- Hard dependency on any skill, plugin, or MCP that not everyone has. Hints stay non-binding; missing ones are skipped.
- Personal data in the shared kit (local paths like `E:\Develop\agents`, the user's private `~/.claude/CLAUDE.md`).

## Design

### Core (any project)
| Agent | Change |
|---|---|
| `researcher` | Keep. Already general: exact-version docs for any library or tool. Reword examples so Next.js is one example, not the default. |
| `architect` | Keep. |
| `developer` | NEW. Implements code in any language. Follows project conventions, small verifiable slices, calls matching skills itself. Hints: incremental-implementation, test-driven-development, api-and-interface-design, source-driven-development, code-simplification. Model sonnet. No `tools:` key (full). |
| `backend` | Keep for services, APIs, data. |
| `tester` | Reword description: after any behavior change, run tests and commands first; use a browser only when the change is UI. Still never edits app code. |
| `qa` | Keep (reproduce, root cause, fix, regressions). |
| `reviewer` | Keep. |
| `security-auditor` | Keep. Remove web-only wording if any. |
| `security` | Keep (architecture-level). |
| `devops` | Keep. |
| `report-writer`, `impeccable-manual-edit-applier` | Not part of the shared kit. Left alone. |

### Web profile (optional)
`web-dev`, `designer`, `frontend`, plus the chrome-devtools MCP (via `.mcp.json` or plugin) and web skill hints.

### `AGENTS.md` template
- Section "Core": roster table and delegation rules (no web).
- Section "Profiles": one block per installed profile. Web block holds the `designer`/`web-dev`/`frontend` rows and the UI order.
- General order: `researcher` -> `architect` (if the task is not small) -> `developer` -> `tester` -> `reviewer` / `security-auditor` -> `devops` (if shipping).
- Web order inside the web profile: `researcher` -> `designer` -> `web-dev` -> `tester` -> ...
- "Versions and docs" rule stays in core.

### Install
User chooses `core` or `core + web`. Core copies the core agents and the core part of `AGENTS.md`;
web adds the web agents, the web block, and the MCP config. Never overwrite existing files.
Exact mechanism is decided in the packaging design.

## Approaches considered
1. Core + profiles with a new `developer` (chosen).
2. Turn `web-dev` into the general coder: rejected, misleading name, loads web guidance for every task.
3. One agent per language: rejected, many files and mostly duplicate.

## Decisions by designer (user may override)
- `developer` model is sonnet, no `tools:` key.
- `report-writer` and `impeccable-manual-edit-applier` stay out of the shared kit.
- Folder layout for profiles is decided at packaging time.

## Risks
- Main agent may still pick the wrong agent: description-based routing is untested (see quality plan).
- `developer` and `backend` may overlap; description must separate them (backend: services, APIs, data; developer: everything else, any language).
- Core `researcher` lists Context7 tools; unknown how Claude Code treats a listed tool that does not exist. Test before sharing.

## Left to builder
- Exact `developer.md` wording within the decisions above.
- Edits to descriptions of `tester`, `researcher`, `security-auditor` and `AGENTS.md` split.
- Test: run a non-web task (for example a small CLI in any language) without naming agents, and check who gets picked.
