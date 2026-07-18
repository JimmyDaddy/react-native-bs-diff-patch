import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, '..');
const bundleBase = path.join(
  os.tmpdir(),
  `react-native-bs-diff-patch-metro-${process.pid}`
);
const bundlePath = `${bundleBase}.js`;
const metroPath = path.join(
  repositoryDirectory,
  'example/node_modules/.bin/metro'
);

const result = spawnSync(
  metroPath,
  [
    'build',
    '../scripts/web-metro-entry.js',
    '--platform',
    'web',
    '--out',
    bundleBase,
    '--config',
    'example/metro.config.js',
    '--minify',
    'false',
  ],
  {
    cwd: repositoryDirectory,
    encoding: 'utf8',
  }
);

if (result.status !== 0) {
  throw new Error(
    `Metro Web build failed:\n${result.stdout || ''}\n${result.stderr || ''}`
  );
}

try {
  const bundle = await readFile(bundlePath, 'utf8');
  assert.match(bundle, /Web Workers are required/);
  assert.match(bundle, /worker\.mjs/);
  assert.doesNotMatch(bundle, /diffBytes is only available on Web/);
  assert.doesNotMatch(bundle, /NativeBsDiffPatch/);
  console.log('Metro selected the React Native Web entry');
} finally {
  await rm(bundlePath, { force: true });
  await rm(`${bundlePath}.map`, { force: true });
}
