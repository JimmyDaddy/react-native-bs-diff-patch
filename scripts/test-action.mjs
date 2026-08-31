import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const tempDirectory = await mkdtemp(
  path.join(os.tmpdir(), 'bsdiffpatch-action-test-')
);
try {
  const oldPath = path.join(tempDirectory, 'old.bin');
  const newPath = path.join(tempDirectory, 'new.bin');
  const patchPath = path.join(tempDirectory, 'update.patch');
  const manifestPath = path.join(tempDirectory, 'manifest.json');
  const outputPath = path.join(tempDirectory, 'github-output.txt');
  await Promise.all([
    writeFile(oldPath, 'baseline\n'.repeat(128)),
    writeFile(newPath, 'target\n'.repeat(128)),
    writeFile(outputPath, ''),
  ]);

  await execFileAsync(process.execPath, [path.resolve('action/index.mjs')], {
    env: {
      ...process.env,
      'GITHUB_OUTPUT': outputPath,
      'INPUT_MANIFEST-FILE': manifestPath,
      'INPUT_MAX-PATCH-RATIO': '1',
      'INPUT_NEW-FILE': newPath,
      'INPUT_OLD-FILE': oldPath,
      'INPUT_PATCH-FILE': patchPath,
      'INPUT_RELEASE-ID': 'test-release',
    },
  });
  const outputs = Object.fromEntries(
    (await readFile(outputPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => line.split('=', 2))
  );
  assert.equal(outputs.strategy, 'patch');
  assert.equal(outputs['patch-file'], patchPath);
  assert.equal(
    JSON.parse(await readFile(manifestPath, 'utf8')).releaseId,
    'test-release'
  );

  await assert.rejects(
    execFileAsync(process.execPath, [path.resolve('action/index.mjs')], {
      env: {
        ...process.env,
        'INPUT_NEW-FILE': newPath,
        'INPUT_OLD-FILE': `${tempDirectory}/missing\n::warning::injected`,
      },
    }),
    (error) =>
      error &&
      error.stderr.includes('%0A::warning::injected') &&
      !error.stderr.includes('\n::warning::injected')
  );
} finally {
  await rm(tempDirectory, { force: true, recursive: true });
}

console.log('GitHub Action test passed');
