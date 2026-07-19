import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, '..');
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), 'react-native-bs-diff-patch-consumer-')
);
const consumerDirectory = path.join(temporaryDirectory, 'consumer');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repositoryDirectory,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stdout || ''}${
        result.stderr || ''
      }`
    );
  }

  return result.stdout.trim();
}

function parseTrailingJson(output) {
  const candidateStarts = [0];

  for (let index = 0; index < output.length; index += 1) {
    if (output[index] === '\n') {
      candidateStarts.push(index + 1);
    }
  }

  for (const start of candidateStarts.reverse()) {
    if (output[start] !== '[' && output[start] !== '{') {
      continue;
    }

    try {
      return JSON.parse(output.slice(start));
    } catch {
      // npm lifecycle output can precede the final JSON document.
    }
  }

  throw new Error(`JSON document not found in command output:\n${output}`);
}

function normalizePackEntries(packMetadata) {
  const entries = Array.isArray(packMetadata)
    ? packMetadata
    : Object.values(packMetadata);

  if (entries.length !== 1 || typeof entries[0]?.filename !== 'string') {
    throw new Error(
      `Unexpected npm pack metadata:\n${JSON.stringify(packMetadata, null, 2)}`
    );
  }

  return entries;
}

assert.equal(
  normalizePackEntries(
    parseTrailingJson('prepare output\n[{"filename":"npm-10.tgz"}]')
  )[0].filename,
  'npm-10.tgz'
);
assert.equal(
  normalizePackEntries(
    parseTrailingJson(
      'prepare output\n{"react-native-bs-diff-patch":{"filename":"npm-11.tgz"}}'
    )
  )[0].filename,
  'npm-11.tgz'
);

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

try {
  const packOutput = normalizePackEntries(
    parseTrailingJson(
      run('npm', [
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        temporaryDirectory,
      ])
    )
  );
  const tarballPath = path.join(temporaryDirectory, packOutput[0].filename);

  await mkdir(consumerDirectory, { recursive: true });
  await writeFile(
    path.join(consumerDirectory, 'package.json'),
    `${JSON.stringify(
      { name: 'package-consumer-smoke', private: true },
      null,
      2
    )}\n`
  );
  run(
    'npm',
    [
      'install',
      tarballPath,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
    ],
    { cwd: consumerDirectory }
  );

  assert.equal(
    await pathExists(path.join(consumerDirectory, 'node_modules/react')),
    false,
    'A browser-only install must not auto-install the optional React peer'
  );
  assert.equal(
    await pathExists(path.join(consumerDirectory, 'node_modules/react-native')),
    false,
    'A browser-only install must not auto-install the optional React Native peer'
  );

  const fakeReactNativeDirectory = path.join(
    consumerDirectory,
    'node_modules/react-native'
  );
  await mkdir(fakeReactNativeDirectory, { recursive: true });
  await writeFile(
    path.join(fakeReactNativeDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'react-native',
        version: '0.0.0-test',
        exports: { import: './index.mjs', require: './index.cjs' },
      },
      null,
      2
    )}\n`
  );
  const fakeRegistry =
    'const moduleValue = { diff: async () => 0, patch: async () => 0 };\n';
  await writeFile(
    path.join(fakeReactNativeDirectory, 'index.mjs'),
    `${fakeRegistry}export const TurboModuleRegistry = { getEnforcing: () => moduleValue };\n`
  );
  await writeFile(
    path.join(fakeReactNativeDirectory, 'index.cjs'),
    `${fakeRegistry}exports.TurboModuleRegistry = { getEnforcing: () => moduleValue };\n`
  );

  const installedPackageDirectory = path.join(
    consumerDirectory,
    'node_modules/react-native-bs-diff-patch'
  );
  const installedManifest = JSON.parse(
    await readFile(path.join(installedPackageDirectory, 'package.json'), 'utf8')
  );
  assert.equal(installedManifest.exports['.'].browser, './web/index.mjs');
  assert.equal(
    installedManifest.exports['.']['react-native'],
    './src/index.ts'
  );

  await writeFile(
    path.join(consumerDirectory, 'resolve.cjs'),
    "console.log(require.resolve('react-native-bs-diff-patch'));\n"
  );
  assert.match(
    run('node', ['resolve.cjs'], { cwd: consumerDirectory }),
    /lib\/commonjs\/index\.js$/
  );

  await writeFile(
    path.join(consumerDirectory, 'resolve.mjs'),
    "console.log(import.meta.resolve('react-native-bs-diff-patch'));\n"
  );
  assert.match(
    run('node', ['resolve.mjs'], { cwd: consumerDirectory }),
    /lib\/module\/index\.js$/
  );

  await writeFile(
    path.join(consumerDirectory, 'load.mjs'),
    [
      "import { diff, diffBytes } from 'react-native-bs-diff-patch';",
      "if ((await diff('old', 'new', 'patch')) !== 0) throw new Error('ESM diff failed');",
      'const error = await diffBytes(new Uint8Array(), new Uint8Array()).catch((value) => value);',
      "if (!error || error.code !== 'EUNSUPPORTED') throw new Error('ESM facade failed');",
    ].join('\n')
  );
  run('node', ['load.mjs'], { cwd: consumerDirectory });

  await writeFile(
    path.join(consumerDirectory, 'load.cjs'),
    [
      "const { diff, diffBytes } = require('react-native-bs-diff-patch');",
      'void (async () => {',
      "  if ((await diff('old', 'new', 'patch')) !== 0) throw new Error('CJS diff failed');",
      '  const error = await diffBytes(new Uint8Array(), new Uint8Array()).catch((value) => value);',
      "  if (!error || error.code !== 'EUNSUPPORTED') throw new Error('CJS facade failed');",
      '})().catch((error) => { console.error(error); process.exitCode = 1; });',
    ].join('\n')
  );
  run('node', ['load.cjs'], { cwd: consumerDirectory });

  await writeFile(
    path.join(consumerDirectory, 'browser.mjs'),
    [
      "import { diffBytes, patch } from 'react-native-bs-diff-patch';",
      "if (typeof diffBytes !== 'function') throw new Error('Missing Web binary API');",
      "const error = await patch('old', 'new', 'patch').catch((value) => value);",
      "if (!error || error.code !== 'EUNSUPPORTED') throw new Error('Wrong Web path API');",
    ].join('\n')
  );
  run('node', ['--conditions=browser', 'browser.mjs'], {
    cwd: consumerDirectory,
  });

  await writeFile(
    path.join(consumerDirectory, 'consumer.ts'),
    [
      "import { diffBytes, type BinaryInput } from 'react-native-bs-diff-patch';",
      'const input: BinaryInput = new Uint8Array([1, 2, 3]);',
      'void diffBytes(input, input);',
    ].join('\n')
  );
  run(
    process.execPath,
    [
      path.join(repositoryDirectory, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--customConditions',
      'browser',
      '--lib',
      'ES2022,DOM',
      'consumer.ts',
    ],
    { cwd: consumerDirectory }
  );

  console.log(
    'Packed consumer install, optional peers, conditional exports, and types passed'
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
