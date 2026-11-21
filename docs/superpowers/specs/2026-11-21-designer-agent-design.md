# `designer` sub-agent — design (short)

Status: approved by user in conversation 2026-11-21 ("ตกลง เขียนเอกสารออกแบบเลย").
Build status: NOT built. User asked to design first; creating the agent file and any live test need a separate go.
Builds on: `2026-11-21-skill-routing-subagents-design.md` (same on-demand skill pattern).

## Intent
A sub-agent that decides visual direction before UI is built, and critiques existing UI. It hands the
result to `web-dev` (builds real code). The main Claude Code session stays the orchestrator.

## Goals
- Before a new page or redesign: produce a viewable mockup plus a short spec.
- On request: critique existing UI (hierarchy, accessibility, copy).
- Mockup delivered as a Claude Artifact (private page on claude.ai); the agent returns the link.
- Same pattern as the other four agents: invoke matching skills itself, return a short result.

## Non-goals
- No Figma (user decision; also not authorized on this machine).
- Does not write or edit app source. Writes only under `design/<job-name>/`.
- No sharing of the Artifact beyond private unless the user asks.
- Not used or tested live yet.

## Anti-goals
- Overlap with `web-dev`: designer decides, web-dev implements.
- Publishing an Artifact that is public, or that reproduces a real brand/organization.
- Silently skipping the Artifact rules (see below).

## Decisions (user-approved unless marked)
- Output: one Artifact page holding the mockup and the spec sections (direction, colors/fonts, layout, on-screen copy, accessibility notes).
- Source copy: `design/<job-name>/index.html` in the working project, so `web-dev` can read it directly. (Designer's call; user may drop it.)
- Before writing: call Artifact `quickstart` (intent `other`), load the `artifact-design` skill, then publish from the file.
- Frontmatter: `name: designer`, `model: sonnet` (designer's call), no `tools:` key (full access, so the browser and the Artifact tool work). Write limit enforced by prompt rule only, as with `tester`.
- `description` (delegation trigger): use before building a new page or redesign, and to critique existing UI.
- Skill hints, non-binding: impeccable, ui-ux-pro-max, modern-web-guidance, design:design-critique, design:accessibility-review, design:ux-copy, accessibility-engineering.
- Shared prompt block, copied verbatim from the other agents: "## Skills" (read list, invoke matching, hints not binding) and "## Result" (short result: what done, evidence, open issues).

## Approaches considered
1. Text spec only: light, but nothing to look at. Rejected.
2. Mockup + spec, delivered as Artifact (chosen). Link is viewable at once; avoids the local-file problem the Browser pane had in the `web-dev` test.
3. Figma file: rejected by user.
4. Fold design into `web-dev`: rejected; mixes deciding and building, and loads more skills per call.

## Risks
- Subagents may not be permitted to call the Artifact tool, or the publish may ask for user approval inside the subagent. Check on first real run; fallback: designer returns the HTML file and the main agent publishes it.
- The write limit is a prompt rule, not enforced.
- `ui-ux-pro-max` may be absent; hints are non-binding.

## Left to builder
- Exact wording of the agent prompt, within the decisions above.
- Copy to `C:\Users\Acer\.claude\agents` without overwriting, then verify structure (same check as the other four).
