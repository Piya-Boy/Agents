# Skill-routing sub-agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four sub-agent definitions that choose and invoke skills themselves per task.

**Architecture:** One Markdown file per agent in `E:\Develop\agents`, same frontmatter style as the existing agents. `Skill` stays available to each agent; a shared prompt block tells the agent to invoke matching skills before working. Hint lists are non-binding.

**Tech Stack:** Claude Code subagent Markdown (frontmatter: name, description, model, tools). Verification by PowerShell script.

**Spec:** `docs/superpowers/specs/2026-11-21-skill-routing-subagents-design.md`

## Global Constraints

- Files go in `E:\Develop\agents` root. Names: `web-dev.md`, `tester.md`, `security-auditor.md`, `devops.md`.
- Do not modify the 10 existing agent files.
- No `skills:` key in frontmatter.
- `tools:` if present must include `Skill`. Omit `tools:` entirely where full access is wanted.
- `description` is a delegation trigger: "Use when/after ...".
- Agent file text is English. Do not guess chrome-devtools MCP tool names.

## Review Focus

- Hinted skill not installed: agent must continue, not fail.
- `security-auditor` must never be able to edit files (no Edit/Write in `tools:`).
- `tester` must not edit app code (prompt rule, as in the talk's example).
- Name clash with existing `qa` / `security` / `frontend`: descriptions must differ in trigger wording.

---

### Task 1: Verify assumptions

**Files:** none changed.

**Interfaces:**
- Produces: confirmed rule for `tools:` + `Skill`; list of real chrome-devtools MCP tool names (or "unavailable").

- [ ] **Step 1: Confirm `tools:` must list `Skill`.** Use the `claude-code-guide` agent: "Do subagents need `Skill` in the `tools` frontmatter to invoke skills? Does omitting `tools` inherit it?" Expected: documented answer. If answer differs from the Global Constraints, update them.
- [ ] **Step 2: List chrome-devtools MCP tools.** ToolSearch query `chrome-devtools`. Expected: tool names like `mcp__chrome-devtools__*`, or none (needs session restart). Record the result for Task 2.
- [ ] **Step 3: Check `ui-ux-pro-max` and `modern-web-guidance` appear in the skills list.** Record present/absent. Absent hints stay in the file anyway (non-binding).

### Task 2: Create the four agent files

**Files:**
- Create: `E:\Develop\agents\web-dev.md`, `tester.md`, `security-auditor.md`, `devops.md`

**Interfaces:**
- Consumes: Task 1 results (tool names, `Skill` rule).
- Produces: four valid agent files.

Shared block, copied into every file body (verbatim):

```
## Skills
Before starting, read the list of available skills. Invoke every skill that matches the task with the Skill tool, then follow it.
The hints below are likely matches, not requirements. If a skill is missing or none fits, continue without it.

## Result
Return a short result: what you did, evidence (commands, output, screenshots), open issues. Not your full history.
```

Per-agent frontmatter and rules:

| File | name | model | tools | description (trigger) | Hints | Extra rule |
|---|---|---|---|---|---|---|
| `web-dev.md` | `web-dev` | sonnet | omit (full) | Use when building or changing web UI: pages, components, layouts, styling, client-side JS. | modern-web-guidance (first, for any client-side HTML/CSS/JS), frontend-ui-engineering, impeccable, ui-ux-pro-max, incremental-implementation | Work in small verifiable slices. |
| `tester.md` | `tester` | sonnet | `Read, Grep, Glob, Bash, Skill` + chrome-devtools tools from Task 1 | Use after any UI or behavior change. Open the app, walk the changed flows, return proof. | browser-testing-with-devtools, test-driven-development, debugging-and-error-recovery | Never edit app code. Report what you saw, with screenshots. |
| `security-auditor.md` | `security-auditor` | opus | `Read, Grep, Glob, Skill` | Use before merge or release, and on any change touching auth, user input, data storage, or third-party integrations. | security-and-hardening, security-audit | Read-only. Report findings with severity and file:line. |
| `devops.md` | `devops` | sonnet | omit (full) | Use for CI/CD, build and deploy pipelines, release prep, rollout and rollback, monitoring. | ci-cd-and-automation, shipping-and-launch, git-workflow-and-versioning, observability-and-instrumentation | Confirm with the main agent before any deploy or push. |

- [ ] **Step 1: Write the four files** using the table and the shared block. Body starts with one sentence "You are the <role>." then Extra rule, then shared block, then `Hints:` bullet list.
- [ ] **Step 2: Re-read each file** once for frontmatter correctness (`---` fences, one-line values).

### Task 3: Verify

**Files:** none changed.

- [ ] **Step 1: Run structural check.**

```powershell
cd E:\Develop\agents
foreach ($n in 'web-dev','tester','security-auditor','devops') {
  $t = Get-Content "$n.md" -Raw
  $ok = $t -match '(?s)^---\r?\nname: '+$n+'\r?\ndescription: .+?\r?\n' -and $t -notmatch '(?m)^skills:' -and $t -match '## Skills'
  "$n $ok"
}
```
Expected: four lines ending `True`.
- [ ] **Step 2: Check read-only agents.** `Select-String -Path security-auditor.md -Pattern '^tools:'` shows no `Edit` or `Write`. Same for `tester.md`.
- [ ] **Step 3: Confirm existing agents unchanged.** Last-write time of the 10 original `.md` files still before today.
- [ ] **Step 4: Live check after session restart.** Ask main agent to run a small UI task; expect it to delegate to `web-dev` and the sub-agent to invoke a skill. Report what happened; if not, say so.
