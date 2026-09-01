import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseAllowedRoots, readAllowedFile, writeAllowedFile } from '../src/security.js';

test('file access stays inside configured roots', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'note.txt');
  await fs.writeFile(file, 'hello');
  assert.deepEqual(parseAllowedRoots(JSON.stringify([root])), [path.resolve(root)]);
  assert.equal((await readAllowedFile(file, [root])).content, 'hello');
  await assert.rejects(() => readAllowedFile(path.join(root, '..', 'outside.txt'), [root]), /不在授权目录|ENOENT/);
  await writeAllowedFile(path.join(root, 'output.txt'), 'safe', [root]);
  assert.equal(await fs.readFile(path.join(root, 'output.txt'), 'utf8'), 'safe');
});
