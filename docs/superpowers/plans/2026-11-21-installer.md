# Agent Kit Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Node script, `kit/install.mjs`, that installs agents, rules files, skills, MCP servers, and plugins into a project from a `kit.json` manifest.

**Architecture:** `install.mjs` exports small functions (arg parsing, profile resolution, command resolution, a runner, one function per layer) and calls `main()` only when run directly. Every external command goes through an injected runner, so tests use a fake runner with no network. Layers return `Result[]`; `main` prints a summary and sets the exit code.

**Tech Stack:** Node `>=22.20.0` stdlib only (`node:test`, `node:fs`, `node:child_process`, `node:readline`). No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-11-21-installer-design.md`

## Global Constraints
- Node floor `>=22.20.0`; stdlib only; no npm dependencies.
- No shell: commands run as argv arrays. Windows `npx` runs as `process.execPath` + npm's `npx-cli.js`; fallback `cmd.exe /d /s /c npx ...` rejects args containing any of `& | ^ % " < > CR LF`.
- Never overwrite an existing user file (`AGENTS.md`, `CLAUDE.md`, agent, skill directory, `.mcp.json` entry). Report it as skipped.
- Never touch `~/.claude/settings.json`, `~/.claude/CLAUDE.md`, or install hooks.
- Never pass `-y` to `claude plugin install`.
- `.mcp.json` uses plain `npx`, never `cmd /c`.
- Exit code 1 if any step failed or preflight failed; a failed step does not stop the others.
- `E:\Develop\agents` is not a git repository today. Before Task 1 run `git init`, then `git switch -c feat/kit-installer`; never commit on `main`. Commit messages are plain Conventional Commits with no attribution trailer (user's global rule).
- Statuses are exactly `installed | skipped | failed | dry-run`; layers are exactly `agents | rules | skills | mcp | plugins`.

## Review Focus
1. Existing `AGENTS.md` / `CLAUDE.md` / agent file in the target: untouched, warning, status `skipped` (Task 3).
2. `.mcp.json` of 0 bytes: treated as `{}`; non-empty invalid JSON: MCP layer reports `failed`, file byte-identical afterwards (Task 5).
3. Project path with spaces and non-ASCII characters (`D:\โปรเจกต์ ใหม่\app`): copies and runner `cwd` work (Tasks 2, 3).
4. Second run after a full run: every item `skipped`, zero runner calls that change anything (Task 7).
5. No TTY and no `--yes`: consent refuses with a message and exit 1, never waits for input (Task 6).

## File Structure
- Create `kit/install.mjs`: all logic, exports below.
- Create `kit/kit.json`, `kit/agents/core/*.md` (10), `kit/agents/web/*.md` (3), `kit/skills/software-engineer/` (with `references/`), `kit/templates/AGENTS.md`, `kit/templates/CLAUDE.md`, `kit/README.md`.
- Create `kit/test/` with `kit.test.mjs`, `runner.test.mjs`, `files.test.mjs`, `skills.test.mjs`, `mcp.test.mjs`, `main.test.mjs`, and `kit/test/helpers.mjs` (temp dirs, fake runner).
- Run all tests with `node --test kit/test` from `E:\Develop\agents`.

## Shared types (used by every task)
```js
// Result: one line of the final summary
// { layer: 'agents'|'rules'|'skills'|'mcp'|'plugins', item: string,
//   status: 'installed'|'skipped'|'failed'|'dry-run', detail?: string }
// Ctx: { kitDir, projectDir, profile: ResolvedProfile, manifest, run, opts: Options, log: (s)=>void }
// Options: { profile:'core'|'web', dryRun:boolean, yes:boolean, skipUser:boolean, only:Set<string>|null }
// ResolvedProfile: { name, agentDirs:string[], skills:{repo:string, skills:'*'|string[]}[],
//   bundledSkills:string[], mcp:string[], plugins:string[] }
// RunFn: (cmd:string, args:string[], o?:{cwd?:string, inherit?:boolean, readOnly?:boolean})
//   => Promise<{code:number, stdout:string, stderr:string}>
```
`helpers.mjs` exports `makeTempProject(): Promise<string>` (new temp dir, caller removes it with `fs.rm`) and `fakeRunner(script?: (cmd,args,o)=>{code?,stdout?,stderr?}): { run: RunFn, calls: {cmd,args,o}[] }` (default reply `{code:0,stdout:'',stderr:''}`).

---

### Task 1: Kit content and manifest

**Files:**
- Create: `kit/kit.json`, `kit/agents/core/*.md`, `kit/agents/web/*.md`, `kit/skills/software-engineer/**`, `kit/templates/AGENTS.md`, `kit/templates/CLAUDE.md`, `kit/install.mjs` (stub exporting `loadManifest`, `resolveProfile`), `kit/test/kit.test.mjs`, `kit/test/helpers.mjs`

**Interfaces:**
- Produces: `loadManifest(kitDir: string): Promise<Manifest>` (reads and JSON-parses `kit.json`; throws `Error('kit.json: <reason>')` on missing or invalid file or `version !== 1`); `resolveProfile(manifest: Manifest, name: string): ResolvedProfile` (follows `extends`; appends agents dirs, skills, bundledSkills, mcp, plugins parent-first; throws `Error('unknown profile: <name>')`; throws on `extends` cycle).

- [ ] **Step 1: Write the failing tests in `kit/test/kit.test.mjs`**
  - `resolveProfile(core)` returns `agentDirs` equal to `['agents/core']`, `mcp` equal to `['context7']`, `plugins` equal to `[]`.
  - `resolveProfile(web)` returns `agentDirs` equal to `['agents/core','agents/web']`, `mcp` equal to `['context7','chrome-devtools']`, `plugins` equal to `['ui-ux-pro-max']`, and `skills` containing `{repo:'GoogleChrome/modern-web-guidance', skills:'*'}` after the core entries.
  - `resolveProfile(manifest,'nope')` throws `/unknown profile: nope/`; a manifest where `a` extends `b` and `b` extends `a` throws `/cycle/`.
  - Against the real `kit/kit.json`: every `*.md` path implied by `agents/core` and `agents/web` exists and starts with a `---` frontmatter line; core has exactly 10 agent files, web exactly 3; every `bundledSkills` name has `kit/skills/<name>/SKILL.md`; every `mcp`/`plugins` name used by a profile exists in the top-level `mcp`/`plugins` maps; `templates/AGENTS.md` contains both `<!-- profile:web:start -->` and `<!-- profile:web:end -->`.
  - `loadManifest` rejects with `/kit.json/` for a directory without the file.

- [ ] **Step 2: Run `node --test kit/test/kit.test.mjs`**
  Expected: FAIL (module/functions not defined).

- [ ] **Step 3: Create the kit content**
  Copy (do not move) from the repo root: `architect backend developer devops qa researcher reviewer security-auditor security tester` `.md` into `kit/agents/core/`; `designer web-dev frontend` `.md` into `kit/agents/web/`; `.claude/skills/software-engineer/` (including `references/`) into `kit/skills/software-engineer/`; `templates/AGENTS.md` and `templates/CLAUDE.md` into `kit/templates/`. Write `kit/kit.json` exactly as in the spec. Do not copy `report-writer.md` or `impeccable-manual-edit-applier.md`.

- [ ] **Step 4: Implement `loadManifest` and `resolveProfile` in `kit/install.mjs`** (ESM, named exports; add the `isMain` guard now: `if (import.meta.url === pathToFileURL(process.argv[1]).href) main(...)` with a placeholder `main` that is replaced in Task 6).

- [ ] **Step 5: Run `node --test kit/test/kit.test.mjs`**
  Expected: PASS.

- [ ] **Step 6: Commit**
  ```bash
  git add kit docs/superpowers/plans/2026-11-21-installer.md
  git commit -m "feat(kit): add kit layout, manifest, and profile resolution"
  ```

### Task 2: Argument parsing, command resolution, runner

**Files:**
- Modify: `kit/install.mjs`
- Test: `kit/test/runner.test.mjs`

**Interfaces:**
- Consumes: `Options` type above.
- Produces:
  - `parseArgs(argv: string[]): Options & { projectDir: string }` (`projectDir` = `process.cwd()`; defaults `profile:'core'`, flags false, `only:null`; throws `Error('--profile must be core or web')`, `Error('unknown flag: <flag>')`, `Error('--only: unknown layer <x>')`).
  - `resolveCommand(name: string, env: {platform:string, pathEnv:string, pathExt:string, execPath:string, exists:(p:string)=>boolean}): {file:string, prefixArgs:string[]} | null`.
  - `assertSafeCmdArgs(args: string[]): void` (throws `Error('unsafe argument for cmd.exe: <arg>')` if any arg contains `& | ^ % " < >` CR or LF).
  - `createRunner(o: {dryRun:boolean, log:(s:string)=>void, spawnFn?:typeof import('node:child_process').spawn, env?: same shape as resolveCommand's env}): RunFn`. In dry-run, a call without `readOnly` logs `[dry-run] <cmd> <args>` and returns `{code:0,stdout:'',stderr:''}` without spawning; `readOnly` calls always spawn. A command that cannot be resolved returns `{code:127, stdout:'', stderr:'command not found: <cmd>'}`. A spawn `error` event returns `{code:1, stdout:'', stderr:<message>}` (never throws).

- [ ] **Step 1: Write the failing tests in `kit/test/runner.test.mjs`**
  - `parseArgs(['--profile','web','--dry-run','--yes','--skip-user','--only','skills,mcp'])` gives `profile:'web'`, `dryRun:true`, `yes:true`, `skipUser:true`, `only` equal to `new Set(['skills','mcp'])`; `parseArgs([])` gives `profile:'core'`, `only:null`.
  - `parseArgs(['--profile','x'])` throws `/--profile must be core or web/`; `['--bogus']` throws `/unknown flag: --bogus/`; `['--only','agents,zzz']` throws `/unknown layer zzz/`.
  - `resolveCommand('npx', {platform:'win32', execPath:'C:\\nodejs\\node.exe', exists: p => p.endsWith('npx-cli.js'), ...})` returns `{file:'C:\\nodejs\\node.exe', prefixArgs:[<path ending 'node_modules\\npm\\bin\\npx-cli.js'>]}`.
  - Same call with `exists: () => false` returns `{file:'cmd.exe', prefixArgs:['/d','/s','/c','npx']}`.
  - `resolveCommand('claude', win32, exists only for 'C:\\bin\\claude.exe' on PATH 'C:\\bin')` returns `{file:'C:\\bin\\claude.exe', prefixArgs:[]}`; when only `claude.cmd` exists returns `{file:'cmd.exe', prefixArgs:['/d','/s','/c','C:\\bin\\claude.cmd']}`; when neither exists returns `null`.
  - POSIX: `resolveCommand('git', {platform:'linux', pathEnv:'/usr/bin', exists: p => p==='/usr/bin/git'})` returns `{file:'/usr/bin/git', prefixArgs:[]}`.
  - `assertSafeCmdArgs(['a&b'])` throws `/unsafe argument/`; `assertSafeCmdArgs(['owner/repo','*','--skill'])` does not throw.
  - Runner with a fake `spawnFn` (EventEmitter child with stdout/stderr streams) returns `{code:0, stdout:'hi', stderr:''}`; dry-run does not call `spawnFn` for a normal call but does for `readOnly:true`; unresolved command returns code 127; a spawn `error` returns code 1 with the message; an argument containing spaces and Thai characters reaches `spawnFn` as one argv element.

- [ ] **Step 2: Run `node --test kit/test/runner.test.mjs`**
  Expected: FAIL.

- [ ] **Step 3: Implement the four functions in `kit/install.mjs`**
  Use `spawn(file, [...prefixArgs, ...args], {cwd, stdio: inherit ? 'inherit' : 'pipe', windowsHide:true, shell:false})`. When the resolved `file` is `cmd.exe`, call `assertSafeCmdArgs` on the user args first (a thrown error becomes `{code:1, stderr:message}`).

- [ ] **Step 4: Run `node --test kit/test/runner.test.mjs`**
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add kit/install.mjs kit/test/runner.test.mjs
  git commit -m "feat(kit): add arg parsing, command resolution, and runner"
  ```

### Task 3: Agents and rules layers

**Files:**
- Modify: `kit/install.mjs`
- Test: `kit/test/files.test.mjs`

**Interfaces:**
- Consumes: `Ctx`, `Result`, `ResolvedProfile`.
- Produces:
  - `stripProfileBlock(text: string, name: string): string` (removes the line `<!-- profile:NAME:start -->`, the line `<!-- profile:NAME:end -->`, and everything between; keeps the rest byte-identical).
  - `installAgents(ctx: Ctx): Promise<Result[]>` (one Result per file in `ctx.profile.agentDirs`, layer `agents`, item = file name).
  - `installRules(ctx: Ctx): Promise<Result[]>` (items `AGENTS.md`, `CLAUDE.md`, layer `rules`).

- [ ] **Step 1: Write the failing tests in `kit/test/files.test.mjs`** (each uses `makeTempProject`, including one under a directory named `โปรเจกต์ ใหม่`)
  - Core install copies all 10 core agent files into `<project>/.claude/agents/`, each Result `installed`; web adds the 3 web files (13 total).
  - A pre-existing `.claude/agents/qa.md` containing `MINE` is unchanged after install, its Result is `skipped` with `detail` matching `/exists/`.
  - Dry-run (`opts.dryRun`) creates no files and returns `dry-run` Results.
  - `installRules` for `core` writes `AGENTS.md` without the strings `profile:web` or `Profile: web`, and writes `CLAUDE.md` equal to the template; for `web` writes `AGENTS.md` equal to the template.
  - A pre-existing `AGENTS.md` containing `MINE` stays byte-identical; Result `skipped`, `detail` matches `/merge/`; `CLAUDE.md` is still handled independently.
  - `stripProfileBlock('a\n<!-- profile:web:start -->\nX\n<!-- profile:web:end -->\nb\n','web')` equals `'a\nb\n'`; input without markers is returned unchanged.

- [ ] **Step 2: Run `node --test kit/test/files.test.mjs`**
  Expected: FAIL.

- [ ] **Step 3: Implement the three functions.** Use `fs.copyFile` with the `COPYFILE_EXCL` flag so an existing file is never overwritten (catch `EEXIST` -> `skipped`). Create `.claude/agents` with `mkdir -p` only when not dry-run.

- [ ] **Step 4: Run `node --test kit/test/files.test.mjs`**
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add kit/install.mjs kit/test/files.test.mjs
  git commit -m "feat(kit): add agents and rules layers"
  ```

### Task 4: Skills layer

**Files:**
- Modify: `kit/install.mjs`
- Test: `kit/test/skills.test.mjs`

**Interfaces:**
- Consumes: `Ctx`, `RunFn`, `manifest.skillsCli`.
- Produces: `installSkills(ctx: Ctx): Promise<Result[]>` (layer `skills`, item = skill name, or `<repo> (all)` for `"*"`).

Behavior pinned by the spec:
- Lock detection: read `<project>/skills-lock.json` (missing = no entries). A named skill is already installed when `lock.skills[name].source === repo` or `<project>/.claude/skills/<name>/SKILL.md` exists.
- For each `{repo, skills}`: a named list gets one runner call per missing skill: `run('npx', ['-y', manifest.skillsCli, 'add', repo, '--agent', 'claude-code', '--skill', name, '-y'], {cwd: projectDir})`. `"*"` gets one call with `'--skill', '*'`, and is `skipped` only if every skill in the repo's lock entries is present and at least one lock entry has that `source`.
- If a call exits non-zero and `process.platform === 'win32'` (injectable as `ctx.platform`), retry once with `'--copy'` added; the Result is `installed` with `detail:'copy fallback'` if the retry succeeds, else `failed` with the last stderr line as `detail`.
- Bundled skills: copy `kit/skills/<name>` recursively to `<project>/.claude/skills/<name>` when the destination does not exist; else `skipped`.

- [ ] **Step 1: Write the failing tests in `kit/test/skills.test.mjs`** (fake runner; manifest `skillsCli:'skills@1.9.0'`)
  - Named skill missing: exactly one call, `cmd==='npx'`, `args` deep-equals `['-y','skills@1.9.0','add','Piya-Boy/piya-skill','--agent','claude-code','--skill','thai-natural-writing','-y']`, `o.cwd` equals the project dir; Result `installed`.
  - Lock contains `thai-natural-writing` with that `source`: zero calls, Result `skipped`.
  - `.claude/skills/strategic-compact/SKILL.md` exists, lock empty: zero calls, `skipped`.
  - `"*"` repo with an empty lock: one call whose args end with `'--skill','*','-y'`.
  - A runner failing with `code:1` on `win32`: second call has `--copy` in args; second success gives `installed` with detail `copy fallback`; both failing gives `failed`. On `linux`: no retry, `failed`.
  - A failure for one repo does not prevent the next repo's calls.
  - Bundled `software-engineer` copied with its `references/` files; second run `skipped`; a pre-existing destination with a marker file is untouched.
  - Dry-run: runner still invoked (the runner itself suppresses spawning), Results are `dry-run`, and no files are copied for bundled skills.

- [ ] **Step 2: Run `node --test kit/test/skills.test.mjs`**
  Expected: FAIL.

- [ ] **Step 3: Implement `installSkills`.** Parse `skills-lock.json` defensively: invalid JSON counts as no entries plus a warning via `ctx.log`.

- [ ] **Step 4: Run `node --test kit/test/skills.test.mjs`**
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add kit/install.mjs kit/test/skills.test.mjs
  git commit -m "feat(kit): add skills layer"
  ```

### Task 5: MCP layer

**Files:**
- Modify: `kit/install.mjs`
- Test: `kit/test/mcp.test.mjs`

**Interfaces:**
- Consumes: `Ctx`, `RunFn`, `manifest.mcp[name] = {command, args, coveredByPlugin?}`.
- Produces:
  - `readMcpJson(file: string): Promise<{mcpServers: Record<string, unknown>}>` (missing file or whitespace-only content -> `{mcpServers:{}}`; invalid JSON -> throws `Error('.mcp.json is not valid JSON')`; valid JSON without `mcpServers` -> `{...obj, mcpServers:{}}`).
  - `installMcp(ctx: Ctx): Promise<Result[]>` (layer `mcp`, item = server name).

Behavior: per server in `ctx.profile.mcp`: skip if the name is in `.mcp.json`; skip with `detail:'covered by plugin <id>'` if `run('claude',['plugin','list','--json'],{readOnly:true})` returns a JSON array containing an id that starts with `coveredByPlugin` (output that cannot be parsed counts as no plugins); otherwise `run('claude', ['mcp','add','--scope','project','--transport','stdio',name,'--',command,...args], {cwd: projectDir})`. If `readMcpJson` throws, every MCP item is `failed` with that message and the file is not modified.

- [ ] **Step 1: Write the failing tests in `kit/test/mcp.test.mjs`**
  - `readMcpJson` on a 0-byte file returns `{mcpServers:{}}`; on `{"mcpServers":{"a":{}}}` returns it; on `{not json` rejects `/not valid JSON/`; on a missing path returns `{mcpServers:{}}`.
  - Empty `.mcp.json`, no plugins: `context7` triggers one `mcp add` call whose args deep-equal `['mcp','add','--scope','project','--transport','stdio','context7','--','npx','-y','@upstash/context7-mcp']`, preceded by one `plugin list --json` call flagged `readOnly`; Result `installed`.
  - `.mcp.json` already has `context7`: no `mcp add`, `skipped`.
  - Plugin list returns `[{"id":"context7@claude-plugins-official"}]`: `skipped` with detail matching `/covered by plugin context7@claude-plugins-official/`.
  - Invalid non-empty `.mcp.json`: Results `failed`, zero `mcp add` calls, file bytes identical before and after.
  - `web` profile with both servers: two `mcp add` calls in order `context7`, `chrome-devtools`; the second keeps `chrome-devtools-mcp@latest` as one argument.
  - The runner failing `mcp add` gives `failed` with the last stderr line; the next server is still attempted.

- [ ] **Step 2: Run `node --test kit/test/mcp.test.mjs`**
  Expected: FAIL.

- [ ] **Step 3: Implement `readMcpJson` and `installMcp`.** Never write `.mcp.json` yourself; only `claude mcp add` does.

- [ ] **Step 4: Run `node --test kit/test/mcp.test.mjs`**
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add kit/install.mjs kit/test/mcp.test.mjs
  git commit -m "feat(kit): add MCP layer"
  ```

### Task 6: Plugins layer, consent, preflight, summary, main

**Files:**
- Modify: `kit/install.mjs`
- Test: `kit/test/main.test.mjs`

**Interfaces:**
- Consumes: all earlier layer functions.
- Produces:
  - `installPlugins(ctx: Ctx): Promise<Result[]>` (layer `plugins`).
  - `preflight(env: {nodeVersion:string, resolve:(name:string)=>unknown}): {ok:boolean, problems:string[]}` (problems for Node below `22.20.0` -> `'node 22.20.0 or newer required (found X)'`, and for each of `git`, `claude` not resolvable -> `'<name> not found on PATH'`).
  - `confirm(question: string, o: {yes:boolean, isTTY:boolean, ask:(q:string)=>Promise<string>}): Promise<boolean>` (`yes` -> true without asking; no TTY and not `yes` -> throws `Error('non-interactive: pass --yes to continue')`; else true only for answers `y`/`yes`, case-insensitive).
  - `listSources(profile: ResolvedProfile, manifest: Manifest): string[]` (lines like `skills: Piya-Boy/piya-skill`, `mcp: npx @upstash/context7-mcp`, `plugin: nextlevelbuilder/ui-ux-pro-max-skill`; only for layers present in `opts.only`).
  - `formatSummary(results: Result[]): string` (grouped by layer, counts line `installed N, skipped N, failed N`, then the next steps: restart Claude Code, run `claude` and approve project MCP servers, fill the `TODO` lines in `AGENTS.md`).
  - `main(argv: string[], deps?: Partial<{env, run, log, ask, isTTY}>): Promise<number>` (exit code).

Plugin behavior: `claude plugin list --json` (`readOnly`) -> ids; skip when `id` present. Otherwise `claude plugin marketplace add <marketplace> --scope user`, then `claude plugin install <id> --scope user` with `{inherit:true}`; never `-y`. A failure of either marks that plugin `failed` and continues. If `isTTY` is false the install step is not run: Result `failed`, `detail:'needs a terminal for approval; run again in a terminal'`.

`main` order: parse args -> preflight (problems -> print, return 1) -> load manifest, resolve profile -> if any of layers 3-5 selected: print `listSources` and `confirm` once (declined -> return 1, nothing changed) -> layers 1, 2 run first -> layers 3, 4 -> layer 5 after its own `confirm` unless `skipUser` (then Result `skipped`, `detail:'--skip-user'`) -> print `formatSummary` -> return 1 if any `failed`, else 0. `--only` limits layers; `rules` needs no consent.

- [ ] **Step 1: Write the failing tests in `kit/test/main.test.mjs`**
  - `confirm`: `yes:true` resolves true and never calls `ask`; `yes:false,isTTY:false` rejects `/--yes/`; answers `Y`, `yes` resolve true; `n`, `''` resolve false.
  - `preflight`: `nodeVersion:'22.19.9'` -> not ok, problem matches `/22\.20\.0/`; `'22.20.0'` and `'24.1.0'` -> ok when git and claude resolve; missing `claude` -> problem `claude not found on PATH`.
  - `installPlugins` (fake runner): not installed -> calls in order `plugin list --json`, `plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill --scope user`, `plugin install ui-ux-pro-max@ui-ux-pro-max-skill --scope user`; no call ever contains `-y`; the install call has `o.inherit===true`; Result `installed`. Already listed: only the list call, `skipped`. `isTTY:false`: marketplace add may run but install does not; `failed` with detail matching `/terminal/`. Marketplace add failing: `failed`, install not attempted.
  - `formatSummary` contains `failed 1` for a failed Result and lists `restart Claude Code`.
  - `main` with a fake runner and temp project: `--dry-run --yes --profile web` returns 0, creates no files in the project, and `calls` contain no non-readOnly spawn. Real-file `--only agents,rules` run returns 0 with files present. Fake runner failing every `mcp add` returns 1 and the plugins layer still ran. Preflight failure returns 1 and changes nothing. Declining consent returns 1 and changes nothing. No TTY and no `--yes` with skills selected returns 1 and the printed text mentions `--yes`, with no call to `ask`.
  - `--skip-user`: plugins Results are `skipped` with detail `--skip-user`, and `confirm` is not asked for layer 5.

- [ ] **Step 2: Run `node --test kit/test/main.test.mjs`**
  Expected: FAIL.

- [ ] **Step 3: Implement the functions and replace the placeholder `main`.** `main` reads real `process.stdin`/`readline` only through `deps.ask`; the default `ask` uses `node:readline/promises`. The `isMain` guard calls `process.exit(await main(process.argv.slice(2)))`.

- [ ] **Step 4: Run the whole suite `node --test kit/test`**
  Expected: all PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add kit/install.mjs kit/test/main.test.mjs
  git commit -m "feat(kit): add plugins layer, consent, preflight, summary, and main"
  ```

### Task 7: README and real-machine verification

**Files:**
- Create: `kit/README.md`
- Modify (only if verification finds a bug): `kit/install.mjs` plus a regression test

**Interfaces:**
- Consumes: the finished script.

README content: what the kit is; requirements (Node `>=22.20.0`, git, claude); usage `node install.mjs --profile core|web` with all flags; the 5 layers and what each changes; what is never touched; Windows troubleshooting (`cmd /c npx` only if MCP shows "Connection closed"; `--copy` for skills link errors); first-run steps (restart Claude Code, approve project MCP servers, fill `AGENTS.md` TODO lines); recommended extras the kit does not install (for example the `suggest-compact.js` hook that goes with the `strategic-compact` skill, because hooks edit `~/.claude/settings.json`).

- [ ] **Step 1: Write `kit/README.md`** as above.

- [ ] **Step 2: Dry run on an empty temp project**
  Run from a new empty directory: `node E:\Develop\agents\kit\install.mjs --profile web --dry-run --yes`
  Expected: every layer prints planned actions, `git status`-equivalent check shows the directory still empty, exit code 0.

- [ ] **Step 3: Real run, core, on a new empty directory**
  Run: `node E:\Develop\agents\kit\install.mjs --profile core --yes --skip-user`
  Expected: `.claude/agents/` has 10 files, `AGENTS.md` lacks the web block, `.claude/skills/` has the installed skills including `thai-natural-writing`, `strategic-compact`, `software-engineer`, `.mcp.json` lists `context7` (or the summary says it is covered by a plugin), exit code 0. Record in the ledger any of the unverified items from the spec that this run answers (`skills ls --json` shape, Windows link behavior, `claude mcp add` duplicate and empty-file behavior).

- [ ] **Step 4: Re-run the same command**
  Expected: every Result `skipped`, exit code 0, `.mcp.json` and `skills-lock.json` unchanged (compare file hashes before and after).

- [ ] **Step 5: Real run, web, on another new directory** (answer the plugin prompt in a terminal)
  Expected: 13 agents, `AGENTS.md` equals the template, `.mcp.json` lists `chrome-devtools`, `ui-ux-pro-max` plugin installed or reported `failed` with a clear reason.

- [ ] **Step 6: Existing-file project**
  In a new directory create `AGENTS.md` containing `MINE` and `.claude/agents/qa.md` containing `MINE`; run core with `--yes --skip-user`.
  Expected: both files still `MINE`, summary warns to merge by hand, other files installed.

- [ ] **Step 7: Headless routing check in the installed core project**
  Run: `claude -p "add a --version flag to the CLI in this project" --output-format stream-json --verbose --permission-mode acceptEdits --max-budget-usd 2` in a small sample project that has the kit installed.
  Expected: stream shows an Agent tool call with `subagent_type` `developer` (reuse the earlier routing-test parser); note the cost.

- [ ] **Step 8: Commit**
  ```bash
  git add kit/README.md
  git commit -m "docs(kit): add README and record verification"
  ```
