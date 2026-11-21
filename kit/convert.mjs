// Turns a Claude Code agent file (Markdown + YAML frontmatter) into the format other tools read.
// Formats checked against each tool's official docs on 2026-11-21; they change often, so keep this
// the only place that knows them.
//
//   claude   .claude/agents/<name>.md           copied as is (not handled here)
//   codex    .codex/agents/<name>.toml          TOML; no tool allowlist, no per-agent model we can trust
//   cursor   .cursor/agents/<name>.md           Markdown; `readonly` instead of `tools`; also reads .claude/agents
//   gemini   .gemini/agents/<name>.md           Markdown; tool names differ from Claude's, so no `tools`
//   copilot  .github/agents/<name>.agent.md     Markdown; accepts Claude tool names as aliases

export function parseAgent(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error('agent file has no frontmatter');
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  if (!meta.name || !meta.description) throw new Error('agent frontmatter needs name and description');
  const tools = meta.tools ? meta.tools.split(',').map((t) => t.trim()).filter(Boolean) : null;
  return { name: meta.name, description: meta.description, model: meta.model ?? null, tools, body: m[2].replace(/\r\n/g, '\n').replace(/^\n+/, '') };
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// An agent that lists tools but none that write is meant to be read-only.
export const isReadOnly = (agent) => Boolean(agent.tools) && !agent.tools.some((t) => WRITE_TOOLS.has(t));

const READ_ONLY_NOTE =
  'This agent is read-only. Do not create, edit, or delete files, and do not run commands that change the project.\n\n';

// Copilot tool aliases (Claude names work as aliases). null = no Copilot tool to map to.
const COPILOT_ALIAS = {
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  Bash: 'execute',
  Edit: 'edit',
  Write: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Skill: null,
};

// Returns the Copilot tools list, or null when it cannot be expressed (then the field is left out).
export function copilotTools(agent) {
  if (!agent.tools) return null;
  const out = [];
  for (const t of agent.tools) {
    if (!(t in COPILOT_ALIAS)) return null;
    const alias = COPILOT_ALIAS[t];
    if (alias && !out.includes(alias)) out.push(alias);
  }
  return out.length ? out : null;
}

// A YAML/TOML-safe single-line string. JSON string syntax is valid in both.
const q = (s) => JSON.stringify(s);

export function tomlMultiline(text) {
  if (!text.includes("'''") ) return `'''\n${text}'''`;
  // Fall back to a basic multi-line string with escapes.
  const esc = text.replace(/\\/g, '\\\\').replace(/"""/g, '""\\"');
  return `"""\n${esc}"""`;
}

function mdAgent(fields, body) {
  const fm = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return `---\n${fm}\n---\n\n${body}`;
}

export function convertAgent(tool, agent) {
  const note = isReadOnly(agent) ? READ_ONLY_NOTE : '';
  const body = agent.body.endsWith('\n') ? agent.body : `${agent.body}\n`;
  switch (tool) {
    case 'codex':
      return {
        path: `.codex/agents/${agent.name}.toml`,
        content: `name = ${q(agent.name)}\ndescription = ${q(agent.description)}\ndeveloper_instructions = ${tomlMultiline(note + body)}\n`,
      };
    case 'cursor':
      return {
        path: `.cursor/agents/${agent.name}.md`,
        content: mdAgent(
          { name: agent.name, description: q(agent.description), model: 'inherit', readonly: isReadOnly(agent) ? 'true' : null },
          body,
        ),
      };
    case 'gemini':
      return {
        path: `.gemini/agents/${agent.name}.md`,
        content: mdAgent({ name: agent.name, description: q(agent.description), model: 'inherit' }, note + body),
      };
    case 'copilot': {
      const tools = copilotTools(agent);
      return {
        path: `.github/agents/${agent.name}.agent.md`,
        content: mdAgent(
          { name: agent.name, description: q(agent.description), tools: tools ? `[${tools.map(q).join(', ')}]` : null },
          // Without a tools list the agent is not restricted, so say it in words.
          (tools || !note ? '' : note) + body,
        ),
      };
    }
    default:
      return null;
  }
}
