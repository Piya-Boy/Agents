import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, detectTools, preflight, formatSummary, installRules, installSkills, main, loadManifest, resolveProfiles, TOOLS } from '../install.mjs';
import { makeTempProject, fakeRunner } from './helpers.mjs';

const kitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const okEnv = { nodeVersion: '24.0.0', resolve: () => ({}) };
const noClaudeEnv = { nodeVersion: '24.0.0', resolve: (n) => (n === 'claude' ? null : {}) };
const exists = (p) => fs.access(p).then(() => true, () => false);

async function ctxFor(dir, tools, opts = {}) {
  const manifest = await loadManifest(kitDir);
  return {
    kitDir,
    projectDir: dir,
    manifest,
    profile: resolveProfiles(manifest, ['core']),
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
    opts: { dryRun: false, yes: true, tools, ...opts },
    log() {},
  };
}

test('parseArgs --tool: default, list, all, order, errors', () => {
  assert.deepEqual(parseArgs([]).tools, ['claude']);
  assert.deepEqual(parseArgs(['--tool', 'codex']).tools, ['codex']);
  assert.deepEqual(parseArgs(['--tool', 'gemini,claude']).tools, ['claude', 'gemini']);
  assert.deepEqual(parseArgs(['--tool', 'cursor,cursor']).tools, ['cursor']);
  assert.deepEqual(parseArgs(['--tool', 'all']).tools, TOOLS);
  assert.deepEqual(parseArgs(['--tool', 'all,codex']).tools, TOOLS);
  assert.throws(() => parseArgs(['--tool', 'vim']), /unknown tool vim/);
  assert.throws(() => parseArgs(['--tool']), /needs a name/);
  assert.throws(() => parseArgs(['--tool', ',']), /needs a name/);
});

test('preflight needs the claude CLI only when claude is a selected tool', () => {
  assert.equal(preflight(noClaudeEnv).ok, false);
  assert.equal(preflight(noClaudeEnv, ['claude', 'codex']).ok, false);
  assert.equal(preflight(noClaudeEnv, ['codex']).ok, true);
  const noGit = preflight({ nodeVersion: '24.0.0', resolve: (n) => (n === 'git' ? null : {}) }, ['codex']);
  assert.match(noGit.problems.join(), /git not found/);
});

test('installRules: default writes AGENTS.md and CLAUDE.md only', async () => {
  const dir = await makeTempProject();
  const res = await installRules(await ctxFor(dir, undefined));
  assert.deepEqual(res.map((r) => r.item), ['AGENTS.md', 'CLAUDE.md']);
  assert.equal(await exists(path.join(dir, 'GEMINI.md')), false);
});

test('installRules: codex only writes AGENTS.md and no CLAUDE.md', async () => {
  const dir = await makeTempProject();
  const res = await installRules(await ctxFor(dir, ['codex']));
  assert.deepEqual(res.map((r) => r.item), ['AGENTS.md']);
  assert.equal(await exists(path.join(dir, 'CLAUDE.md')), false);
});

test('installRules: gemini adds GEMINI.md that imports AGENTS.md', async () => {
  const dir = await makeTempProject();
  const res = await installRules(await ctxFor(dir, ['gemini']));
  assert.deepEqual(res.map((r) => [r.item, r.status]), [['AGENTS.md', 'installed'], ['GEMINI.md', 'installed']]);
  const g = await fs.readFile(path.join(dir, 'GEMINI.md'), 'utf8');
  assert.ok(g.startsWith('@AGENTS.md'));
});

test('installRules: all tools writes the three files; an existing GEMINI.md is left alone', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, 'GEMINI.md'), 'MINE');
  const res = await installRules(await ctxFor(dir, [...TOOLS]));
  assert.deepEqual(res.map((r) => r.item), ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
  assert.equal(await fs.readFile(path.join(dir, 'GEMINI.md'), 'utf8'), 'MINE');
  assert.equal(res.find((r) => r.item === 'GEMINI.md').status, 'skipped');
});

test('installRules: --merge-rules still works with other tools', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, 'AGENTS.md'), 'MINE\n');
  const res = await installRules(await ctxFor(dir, ['codex'], { mergeRules: true }));
  assert.equal(res[0].status, 'installed');
  assert.ok((await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8')).startsWith('MINE\n'));
});

test('formatSummary next steps depend on the tools', () => {
  const rows = [{ layer: 'rules', item: 'AGENTS.md', status: 'installed' }];
  const claude = formatSummary(rows);
  assert.match(claude, /1\. Restart Claude Code/);
  assert.match(claude, /3\. Fill the TODO lines/);
  const codex = formatSummary(rows, ['codex']);
  assert.ok(!/Claude Code/.test(codex));
  assert.match(codex, /1\. Codex reads `\.codex\/config\.toml`/);
  assert.match(codex, /2\. Fill the TODO lines/);
  assert.match(formatSummary(rows, ['gemini']), /1\. Gemini CLI reads `\.gemini\/settings\.json`/);
  assert.ok(!/trusted/.test(formatSummary(rows, ['cursor', 'copilot'])));
});

test('main --tool codex: no claude CLI needed, rules only writes AGENTS.md and spawns nothing', async () => {
  const dir = await makeTempProject();
  const logs = [];
  const f = fakeRunner();
  const code = await main(['--tool', 'codex', '--only', 'rules', '--yes'], { projectDir: dir, env: noClaudeEnv, log: (l) => logs.push(l), isTTY: false, run: f.run });
  assert.equal(code, 0);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['AGENTS.md']);
  assert.equal(f.calls.length, 0, 'no command is spawned');
  const out = logs.join('\n');
  assert.ok(!/Third-party sources/.test(out));
  assert.ok(!/Restart Claude Code/.test(out));
});

test('main --tool claude,codex: claude mcp add runs and codex gets its own config file', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner((cmd, args) => (args[0] === 'plugin' ? { stdout: '[]' } : {}));
  const code = await main(['--tool', 'claude,codex', '--only', 'rules,mcp', '--yes'], { projectDir: dir, env: okEnv, log() {}, isTTY: false, run: f.run });
  assert.equal(code, 0);
  assert.ok(f.calls.some((c) => c.args[0] === 'mcp'), 'claude mcp add still runs');
  assert.equal(await exists(path.join(dir, 'CLAUDE.md')), true);
  assert.match(await fs.readFile(path.join(dir, '.codex/config.toml'), 'utf8'), /\[mcp_servers\.context7\]/);
});

test('main --tool codex with --auto-check and plugins: reported as Claude Code only', async () => {
  const dir = await makeTempProject();
  const logs = [];
  const code = await main(['--tool', 'codex', '--profile', 'superpowers', '--auto-check', '--yes'], { projectDir: dir, env: noClaudeEnv, log: (l) => logs.push(l), isTTY: false, run: fakeRunner().run });
  assert.equal(code, 0);
  const out = logs.join('\n');
  assert.match(out, /\[hooks\]\n +skipped +codex \(Claude Code only\)/);
  assert.match(out, /\[plugins\]\n +skipped +codex \(Claude Code only\)/);
  assert.equal(await exists(path.join(dir, '.claude')), false);
});

test('main without --tool is unchanged: the claude CLI is still required', async () => {
  const dir = await makeTempProject();
  const logs = [];
  const code = await main(['--only', 'rules'], { projectDir: dir, env: noClaudeEnv, log: (l) => logs.push(l), isTTY: false, run: fakeRunner().run });
  assert.equal(code, 1);
  assert.match(logs.join('\n'), /claude not found on PATH/);
});

// ---- skills for the other tools: .agents/skills/ ----

const named = [{ repo: 'Piya-Boy/piya-skill', skills: ['thai-natural-writing'] }];

function skillsCtx(dir, run, tools, { skills = named, bundledSkills = [], dryRun = false } = {}) {
  return {
    kitDir,
    projectDir: dir,
    manifest: { skillsCli: 'skills@1.9.0' },
    profile: { name: 'core', agentDirs: [], skills, bundledSkills, mcp: [], plugins: [] },
    run,
    opts: { dryRun, tools },
    platform: 'linux',
    log() {},
  };
}

test('skills: each non-Claude tool uses its skills CLI agent id', async () => {
  for (const [tool, id] of [['codex', 'codex'], ['cursor', 'cursor'], ['gemini', 'gemini-cli'], ['copilot', 'github-copilot']]) {
    const f = fakeRunner();
    const res = await installSkills(skillsCtx(await makeTempProject(), f.run, [tool]));
    assert.equal(f.calls.length, 1, tool);
    assert.deepEqual(f.calls[0].args, ['-y', 'skills@1.9.0', 'add', 'Piya-Boy/piya-skill', '--agent', id, '--skill', 'thai-natural-writing', '-y']);
    assert.equal(res[0].item, 'thai-natural-writing', 'no suffix when Claude is not selected');
  }
});

test('skills: several non-Claude tools share one pass into .agents/skills', async () => {
  const f = fakeRunner();
  await installSkills(skillsCtx(await makeTempProject(), f.run, ['codex', 'gemini']));
  assert.equal(f.calls.length, 1);
});

test('skills: claude plus another tool runs two passes; the lock does not hide the .agents pass', async () => {
  const dir = await makeTempProject();
  await fs.writeFile(path.join(dir, 'skills-lock.json'), JSON.stringify({ version: 2, skills: { 'thai-natural-writing': { source: 'Piya-Boy/piya-skill' } } }));
  const f = fakeRunner();
  const res = await installSkills(skillsCtx(dir, f.run, ['claude', 'cursor']));
  assert.equal(f.calls.length, 1, 'only the .agents pass runs');
  assert.ok(f.calls[0].args.includes('cursor'));
  assert.deepEqual(res.map((r) => [r.item, r.status]), [['thai-natural-writing', 'skipped'], ['thai-natural-writing (.agents)', 'installed']]);
});

test('skills: a skill already in .agents/skills is skipped', async () => {
  const dir = await makeTempProject();
  await fs.mkdir(path.join(dir, '.agents/skills/thai-natural-writing'), { recursive: true });
  await fs.writeFile(path.join(dir, '.agents/skills/thai-natural-writing/SKILL.md'), 'x');
  const f = fakeRunner();
  const res = await installSkills(skillsCtx(dir, f.run, ['codex']));
  assert.equal(f.calls.length, 0);
  assert.equal(res[0].status, 'skipped');
});

test('skills: bundled skill is copied to .agents/skills for non-Claude tools, never to .claude', async () => {
  const dir = await makeTempProject();
  const res = await installSkills(skillsCtx(dir, fakeRunner().run, ['codex'], { skills: [], bundledSkills: ['software-engineer'] }));
  assert.equal(res[0].status, 'installed');
  assert.equal(await exists(path.join(dir, '.agents/skills/software-engineer/SKILL.md')), true);
  assert.equal(await exists(path.join(dir, '.claude')), false);
  const again = await installSkills(skillsCtx(dir, fakeRunner().run, ['codex'], { skills: [], bundledSkills: ['software-engineer'] }));
  assert.equal(again[0].status, 'skipped');
});

test('skills: default tools still write .claude/skills with the claude-code agent id', async () => {
  const f = fakeRunner();
  const dir = await makeTempProject();
  await installSkills(skillsCtx(dir, f.run, undefined, { skills: [], bundledSkills: ['software-engineer'] }));
  assert.equal(await exists(path.join(dir, '.claude/skills/software-engineer/SKILL.md')), true);
  assert.equal(await exists(path.join(dir, '.agents')), false);
});

test('main --tool codex: skills run, and the third-party prompt appears without --yes', async () => {
  const dir = await makeTempProject();
  const logs = [];
  const code = await main(['--tool', 'codex', '--only', 'skills'], { projectDir: dir, env: noClaudeEnv, log: (l) => logs.push(l), isTTY: false, run: fakeRunner().run });
  assert.equal(code, 1);
  assert.match(logs.join('\n'), /--yes/);
  const f = fakeRunner();
  const code2 = await main(['--tool', 'codex', '--only', 'skills', '--yes'], { projectDir: dir, env: noClaudeEnv, log: (l) => logs.push(l), isTTY: false, run: f.run });
  assert.equal(code2, 0);
  assert.ok(f.calls.length > 0 && f.calls.every((c) => c.args.includes('codex')));
});

test('antigravity: agy alias, tool order, rules, skills id', async () => {
  assert.deepEqual(parseArgs(['--tool', 'agy']).tools, ['antigravity']);
  assert.deepEqual(parseArgs(['--tool', 'agy,antigravity,codex']).tools, ['codex', 'antigravity']);
  assert.ok(TOOLS.includes('antigravity'));
  assert.throws(() => parseArgs(['--tool', 'agyy']), /unknown tool agyy/);
  const dir = await makeTempProject();
  const rules = await installRules(await ctxFor(dir, ['antigravity']));
  assert.deepEqual(rules.map((r) => r.item), ['AGENTS.md'], 'Antigravity reads AGENTS.md itself');
  const f = fakeRunner();
  await installSkills(skillsCtx(await makeTempProject(), f.run, ['antigravity']));
  assert.deepEqual(f.calls[0].args.slice(3, 6), ['Piya-Boy/piya-skill', '--agent', 'antigravity-cli']);
});

test('main --tool agy: no claude CLI, agents, skills, and MCP for Antigravity only', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner();
  const code = await main(['--tool', 'agy', '--only', 'agents,rules,mcp', '--yes'], { projectDir: dir, env: noClaudeEnv, log() {}, isTTY: false, run: f.run });
  assert.equal(code, 0);
  assert.equal(f.calls.length, 0);
  for (const p of ['AGENTS.md', '.agents/agents/qa.md', '.agents/mcp_config.json']) assert.equal(await exists(path.join(dir, p)), true, p);
  assert.equal(await exists(path.join(dir, '.claude')), false);
});

test('formatSummary mentions the Antigravity MCP approval, only for Antigravity', () => {
  const rows = [{ layer: 'rules', item: 'AGENTS.md', status: 'installed' }];
  assert.match(formatSummary(rows, ['antigravity']), /1\. Antigravity asks before each MCP tool call/);
  assert.ok(!/Antigravity/.test(formatSummary(rows, ['codex'])));
});

test('parseArgs --tool auto: flagged for main, mixes with names, all wins', () => {
  assert.equal(parseArgs([]).autoTool, false);
  const a = parseArgs(['--tool', 'auto']);
  assert.equal(a.autoTool, true);
  assert.deepEqual(a.tools, []);
  assert.deepEqual(parseArgs(['--tool', 'auto,gemini']).tools, ['gemini']);
  assert.equal(parseArgs(['--tool', 'auto,all']).autoTool, false);
  assert.deepEqual(parseArgs(['--tool', 'auto,all']).tools, TOOLS);
});

const mk = async (dir, rel, file = false) => {
  const p = path.join(dir, ...rel.split('/'));
  if (file) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, 'x');
  } else await fs.mkdir(p, { recursive: true });
};

test('detectTools: empty project falls back to claude', async () => {
  assert.deepEqual(await detectTools(await makeTempProject()), ['claude']);
});

test('detectTools: reads each tool marker, in TOOLS order', async () => {
  const dir = await makeTempProject();
  await mk(dir, '.codex');
  await mk(dir, '.cursorrules', true);
  await mk(dir, 'GEMINI.md', true);
  await mk(dir, '.github/copilot-instructions.md', true);
  await mk(dir, '.agents/mcp_config.json', true);
  await mk(dir, 'opencode.json', true);
  await mk(dir, 'CLAUDE.md', true);
  assert.deepEqual(await detectTools(dir), TOOLS);
});

test('detectTools: .agents/skills alone does not mean Antigravity', async () => {
  const dir = await makeTempProject();
  await mk(dir, '.codex');
  await mk(dir, '.agents/skills/x/SKILL.md', true);
  assert.deepEqual(await detectTools(dir), ['codex']);
});

test('main --tool auto: installs for the detected tool only, no claude CLI needed', async () => {
  const dir = await makeTempProject();
  await mk(dir, '.codex');
  const logs = [];
  const f = fakeRunner();
  const code = await main(['--tool', 'auto', '--only', 'rules', '--yes'], { projectDir: dir, env: noClaudeEnv, log: (l) => logs.push(l), isTTY: false, run: f.run });
  assert.equal(code, 0);
  assert.ok(logs.some((l) => /Detected tools: codex/.test(l)));
  assert.equal(f.calls.length, 0);
  assert.equal(await fs.access(path.join(dir, 'AGENTS.md')).then(() => true, () => false), true);
  assert.equal(await fs.access(path.join(dir, 'CLAUDE.md')).then(() => true, () => false), false);
});

test('main --tool auto: nothing detected behaves like the default (claude)', async () => {
  const dir = await makeTempProject();
  const logs = [];
  const code = await main(['--tool', 'auto', '--only', 'rules'], { projectDir: dir, env: noClaudeEnv, log: (l) => logs.push(l), isTTY: false, run: fakeRunner().run });
  assert.equal(code, 1);
  assert.ok(logs.some((l) => /Detected tools: claude/.test(l)));
  assert.ok(logs.some((l) => /claude/i.test(l) && /error/.test(l)));
});

test('opencode: parse, tool order, skills id, and a real run writes agents, MCP, and rules', async () => {
  assert.deepEqual(parseArgs(['--tool', 'opencode']).tools, ['opencode']);
  assert.deepEqual(parseArgs(['--tool', 'opencode,claude']).tools, ['claude', 'opencode']);
  assert.ok(TOOLS.includes('opencode'));
  const dir = await makeTempProject();
  const f = fakeRunner();
  const code = await main(['--tool', 'opencode', '--only', 'agents,rules,mcp', '--yes'], { projectDir: dir, env: noClaudeEnv, log() {}, isTTY: false, run: f.run });
  assert.equal(code, 0);
  assert.equal(f.calls.length, 0, 'no claude CLI');
  assert.equal(await exists(path.join(dir, '.opencode/agents/developer.md')), true);
  assert.equal(await exists(path.join(dir, 'opencode.json')), true);
  assert.equal(await exists(path.join(dir, 'AGENTS.md')), true);
  assert.equal(await exists(path.join(dir, '.claude')), false);
});

test('skills: opencode uses its own skills CLI id and the shared .agents/skills folder', async () => {
  const dir = await makeTempProject();
  const f = fakeRunner();
  const ctx = await ctxFor(dir, ['opencode']);
  ctx.run = f.run;
  await installSkills(ctx);
  assert.ok(f.calls.some((c) => c.args.includes('opencode')));
});
