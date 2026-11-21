import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function makeTempProject(sub = 'proj') {
  const root = await mkdtemp(path.join(tmpdir(), 'kit-test-'));
  const dir = path.join(root, sub);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function fakeRunner(script) {
  const calls = [];
  const run = async (cmd, args, o = {}) => {
    calls.push({ cmd, args, o });
    const r = (script && script(cmd, args, o)) || {};
    return { code: 0, stdout: '', stderr: '', ...r };
  };
  return { run, calls };
}
