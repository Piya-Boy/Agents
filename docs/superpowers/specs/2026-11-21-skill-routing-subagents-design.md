# Skill-routing sub-agents — design (short)

Status: approved by user in conversation 2026-11-21 ("ลองจัดมา").

## Intent
Main Claude Code session plans and delegates. Four focused sub-agents do the work. Each sub-agent
picks and invokes the skills that fit the task itself, instead of having skills hard-wired.
Pattern taken from the GDG DevFest 2026 talk "Modern Web Development with AI coding Workflow".

## Goals
- Four new agent files in `E:\Develop\agents`: `web-dev.md`, `tester.md`, `security-auditor.md`, `devops.md`.
- Each `description` is a delegation trigger (when the main agent should hand work over).
- Each agent keeps `Skill` available and is told: list available skills, invoke the matching one before working.
- Each agent has a non-binding hint list of likely skills.
- Small context: agents return a short result, not full history.

## Non-goals
- No change to the 10 existing agents.
- No standalone app / Agent SDK build.
- No `skills:` preload in frontmatter (loads full skill text every call; conflicts with "pick by task").
- No orchestrator file. Main session is the orchestrator. Rule "plan and delegate, do not edit code
  yourself" goes into a project CLAUDE.md only if the user asks.

## Anti-goals
- Agents that silently skip skills, or that hard-fail when a hinted skill is missing.
- Duplicate-name confusion with existing agents (`qa`, `security`, `frontend`).

## Approaches considered
1. New 4 agents, on-demand skills (chosen).
2. Add `skills:` preload to the existing 10 agents: rejected, name overlap and always-on context cost.
3. Agent SDK app: rejected, heavier than the pattern shown.

## Hints (non-binding)
- web-dev: modern-web-guidance (before any client-side HTML/CSS/JS), frontend-ui-engineering, impeccable, ui-ux-pro-max, incremental-implementation
- tester: browser-testing-with-devtools, test-driven-development, debugging-and-error-recovery
- security-auditor: security-and-hardening, security-audit. Read-only.
- devops: ci-cd-and-automation, shipping-and-launch, git-workflow-and-versioning, observability-and-instrumentation

## Open items left to builder
- Exact chrome-devtools MCP tool names for `tester` (verify after session restart; do not guess).
- `ui-ux-pro-max` availability (plugin installed by user, visible after restart).
- Confirm `tools:` listing must include `Skill` for sub-agents to invoke skills.
- Models: web-dev sonnet, tester sonnet, security-auditor opus, devops sonnet (builder's call, matches existing style).
