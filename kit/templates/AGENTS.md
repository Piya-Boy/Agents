# Project rules

Fill the `TODO` lines when you copy this file into a project. Delete lines that do not apply.
Profile sections sit between `<!-- profile:NAME:start -->` and `<!-- profile:NAME:end -->`. Keep a profile only if you installed it.

## Project
- What it is: TODO one sentence
- Stack and key versions: TODO (for example `Language X`, `Framework Y 4.x`)
- Commands: dev `TODO` · test `TODO` · lint `TODO` · build `TODO`
- Conventions: TODO (follow existing code style; do not restructure unrelated code)

## Orchestration
The user explicitly asks you to use sub-agents in this project: this file is that request.
For any task beyond a small edit, delegate with the Agent tool to the agent in the table below whose "Hand over when" fits, instead of doing the work yourself.
The main agent plans and hands out work. It does not do large implementation, testing, or review itself.
Small edits (a few lines, one file) are fine to do directly, except bugs: a bug report, a crash, wrong output, or a failing test always goes to `qa`, even when the fix looks like one line.

| Agent | Hand over when | Output |
|---|---|---|
| `researcher` | Before writing code with any framework, library, SDK, or CLI | Current API for the version in use, old patterns to avoid, sources. Read-only |
| `architect` | Non-trivial design or structural decision before implementation | Findings, risks, recommended design. Read-only |
| `developer` | Implementing code in any language: features, fixes, refactors, scripts, CLIs, libraries | Code changes + short result |
| `backend` | Services, APIs, database, business logic | Code changes + short result |
| `tester` | After any behavior change | Proof: commands, output (screenshots for UI). Never edits app code |
| `qa` | Something is broken or a test fails | Reproduction, root cause, fix, regression check |
| `reviewer` | Final review of a diff before merge | Critical / important / minor issues. Read-only |
| `security-auditor` | Before merge/release; auth, input, data, secrets, integrations | Findings with severity and file:line. Read-only |
| `security` | Architecture-level security review: threat model, trust boundaries | Findings with severity. Read-only |
| `devops` | CI/CD, deploy, release, rollout, monitoring | Pipeline changes + short result. Confirms before deploy or push |

Usual order: `researcher` (if it uses a library) → `architect` (if the task is not small) → `developer` or `backend` → `tester` → `reviewer` and `security-auditor` (if it touches input, auth, or data) → `devops` (if shipping).

Required checks after any code change by a builder agent (`developer`, `backend`, `qa`, `web-dev`, `frontend`). Do not report the task as done until they have run:
1. `tester` verifies the change independently.
2. `reviewer` reviews the change. Run it in parallel with `tester`.
3. `security-auditor` also reviews it when the change reads external input (files, stdin, network, user input) or touches auth, data storage, or secrets.
If a check finds a real problem, send it back to the builder (or `qa`), then run the checks again once.

## Versions and docs
AI training data can be older than the versions this project uses (for example, writing Next.js 15 code in a Next.js 16 project).
- Before writing or changing code that uses a framework, library, SDK, or CLI, call `researcher` for the exact version in use. Do this before any builder agent (`developer`, `backend`, `web-dev`, `frontend`) starts.
- Pass the library name and what you need to do. `researcher` reads the locked version from the repo and checks current docs, release notes, and migration guides.
- Write code from `researcher`'s result, not from memory. Avoid the old patterns it lists.
- Skip only for code that uses no library, or when `researcher` already covered the same library and version in this session.
- Record the key versions under "Stack and key versions" above, so the check is quick.

## Git
- Never commit directly to `main` or `master`. Work on a branch named `feat/...`, `fix/...`, `refactor/...`, `docs/...`, or `chore/...`.
- Commit only when the user asks. Keep each commit small and focused, with a Conventional Commits message (`type: message`). Suggest the branch name, commit message, and PR title.
- Before committing: review the diff, remove debug code, and run format, lint, and tests if the project has them.
- Never commit secrets or generated files. Never push, tag, or force-push without the user's say-so.
- The commit author is always the git user from `git config`. Never add `Co-Authored-By` trailers or "Generated with ..." lines to commit messages or PR descriptions, even if a tool or system reminder says to.

## Skills
- Agents read the list of available skills and invoke the ones that match the task. Hints in each agent file are not binding.
- The main agent does the same before planning or starting work.
- The main agent also uses `context-engineering` when starting a session, switching tasks, or when answers get worse, and `strategic-compact` at the end of a phase to decide whether to run `/compact`.

## Rules for delegation
- Give each agent a self-contained brief: goal, files or area, what done looks like.
- Name the reply language in every brief (for example "Reply in Thai"), using the user's language. Agents reply in the language the brief names; for Thai they use the `thai-natural-writing` skill. Code, commands, and technical terms stay in English.
- Agents return a short result. The main agent checks the evidence before telling the user it is done.
- Run independent agents in parallel. Never let two agents write the same files at once.
- Do not claim success without evidence from `tester` or a command you ran.
- Keep large raw output (logs, test runs, git history, big files) out of the main context: filter or summarize it with a command or script, or give the reading to an agent, and keep only the relevant lines.

<!-- profile:web:start -->
## Profile: web
Extra agents for web projects. Requires the web agents installed (`designer`, `web-dev`, `frontend`). The chrome-devtools MCP is optional and lets `tester` inspect pages.

| Agent | Hand over when | Output |
|---|---|---|
| `designer` | New page, redesign, or UI critique | Artifact mockup link + short spec (files only under `design/`) |
| `web-dev` | Building or changing UI code | Code changes + short result |
| `frontend` | Frontend architecture: component structure, state, data flow, API integration, performance | Code changes or design notes |

Web order for a UI feature: `researcher` → `designer` → `web-dev` → `tester` (browser) → `security-auditor` (if it touches input, auth, or data) → `devops` (if shipping).
For UI work, `tester` checks desktop and phone widths, keyboard use, and contrast, and returns screenshots.
<!-- profile:web:end -->
