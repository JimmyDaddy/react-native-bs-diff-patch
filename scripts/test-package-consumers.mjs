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
const suppliedTarball = process.env.PACKAGE_TARBALL
  ? path.resolve(process.env.PACKAGE_TARBALL)
  : undefined;

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
  if (suppliedTarball) {
    await access(suppliedTarball);
  }
  const tarballPath = suppliedTarball
    ? suppliedTarball
    : path.join(
        temporaryDirectory,
        normalizePackEntries(
          parseTrailingJson(
            run('npm', [
              'pack',
              '--ignore-scripts',
              '--json',
              '--pack-destination',
              temporaryDirectory,
            ])
          )
        )[0].filename
      );

  await mkdir(consumerDirectory, { recursive: true });
  await writeFile(
    path.join(consumerDirectory, 'package.json'),
    `${JSON.stringify(
      { name: 'package-consumer-smoke', private: true },
      null,
      2
    )}\n`
  );
  run('npm', ['install', tarballPath, '--no-audit', '--no-fund'], {
    cwd: consumerDirectory,
  });

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
  const dependencyTree = JSON.parse(
    run('npm', ['ls', '--omit=dev', '--all', '--json'], {
      cwd: consumerDirectory,
    })
  );
  assert.equal(
    Object.hasOwn(dependencyTree.dependencies || {}, 'react-native'),
    false,
    'The packed browser consumer dependency tree must not contain React Native'
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
    `${fakeRegistry}export class NativeEventEmitter { addListener() { return { remove() {} }; } }\nexport const TurboModuleRegistry = { getEnforcing: () => moduleValue };\n`
  );
  await writeFile(
    path.join(fakeReactNativeDirectory, 'index.cjs'),
    `${fakeRegistry}exports.NativeEventEmitter = class NativeEventEmitter { addListener() { return { remove() {} }; } };\nexports.TurboModuleRegistry = { getEnforcing: () => moduleValue };\n`
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
    installedManifest.exports['.'].types.browser,
    './web/index.d.mts'
  );
  assert.equal(installedManifest.exports['./web'].import, './web/index.mjs');
  assert.equal(installedManifest.exports['./web'].types, './web/index.d.mts');
  assert.equal(installedManifest.exports['./node'].node, './node/index.mjs');
  assert.equal(
    installedManifest.exports['./toolkit'].import,
    './toolkit/index.mjs'
  );
  assert.equal(
    typeof installedManifest.bin === 'string'
      ? installedManifest.bin
      : installedManifest.bin['react-native-bs-diff-patch'],
    './bin/react-native-bs-diff-patch.mjs'
  );
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
    path.join(consumerDirectory, 'resolve-web.mjs'),
    "console.log(import.meta.resolve('react-native-bs-diff-patch/web'));\n"
  );
  assert.match(
    run('node', ['resolve-web.mjs'], { cwd: consumerDirectory }),
    /web\/index\.mjs$/
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
      "import { diffBytes, inspectPatch, patch } from 'react-native-bs-diff-patch';",
      "if (typeof diffBytes !== 'function') throw new Error('Missing Web binary API');",
      "if (typeof inspectPatch !== 'function') throw new Error('Missing patch metadata API');",
      "const error = await patch('old', 'new', 'patch').catch((value) => value);",
      "if (!error || error.code !== 'EUNSUPPORTED') throw new Error('Wrong Web path API');",
    ].join('\n')
  );
  run('node', ['--conditions=browser', 'browser.mjs'], {
    cwd: consumerDirectory,
  });

  await writeFile(
    path.join(consumerDirectory, 'web.mjs'),
    [
      "import { diffBytes, inspectPatch, startDiffBytes } from 'react-native-bs-diff-patch/web';",
      "if (typeof diffBytes !== 'function' || typeof inspectPatch !== 'function' || typeof startDiffBytes !== 'function') throw new Error('Missing explicit Web API');",
    ].join('\n')
  );
  run('node', ['web.mjs'], { cwd: consumerDirectory });

  await writeFile(
    path.join(consumerDirectory, 'pipeline.mjs'),
    [
      "import { inspectPatchFile } from 'react-native-bs-diff-patch/node';",
      "import { canonicalJson, createPatchManifest } from 'react-native-bs-diff-patch/toolkit';",
      "if (typeof inspectPatchFile !== 'function') throw new Error('Missing Node API');",
      'if (canonicalJson({ b: 1, a: 2 }) !== \'{"a":2,"b":1}\') throw new Error(\'Toolkit mismatch\');',
      "if (createPatchManifest({ baseline: { bytes: 1, sha256: '1'.repeat(64) }, patch: { bytes: 1, sha256: '2'.repeat(64) }, target: { bytes: 1, sha256: '3'.repeat(64) } }).version !== 1) throw new Error('Manifest mismatch');",
    ].join('\n')
  );
  run('node', ['pipeline.mjs'], { cwd: consumerDirectory });
  const installedCliPath = path.join(
    installedPackageDirectory,
    'bin/react-native-bs-diff-patch.mjs'
  );
  const oldArtifactPath = path.join(consumerDirectory, 'old.bin');
  const newArtifactPath = path.join(consumerDirectory, 'new.bin');
  const patchArtifactPath = path.join(consumerDirectory, 'update.patch');
  await Promise.all([
    writeFile(oldArtifactPath, 'packed old artifact\n'.repeat(32)),
    writeFile(newArtifactPath, 'packed new artifact\n'.repeat(32)),
  ]);
  run(
    'node',
    [
      installedCliPath,
      'diff',
      oldArtifactPath,
      newArtifactPath,
      '-o',
      patchArtifactPath,
    ],
    { cwd: consumerDirectory }
  );
  run(
    'node',
    [
      installedCliPath,
      'verify',
      oldArtifactPath,
      patchArtifactPath,
      newArtifactPath,
    ],
    { cwd: consumerDirectory }
  );

  await writeFile(
    path.join(consumerDirectory, 'consumer.ts'),
    [
      "import { diffBytes, inspectPatch, verifyPatch, type BinaryInput, type PatchMetadata } from 'react-native-bs-diff-patch';",
      "import { startDiff as startWebDiff, type BinaryOperationJob } from 'react-native-bs-diff-patch/web';",
      "import { inspectPatchFile, type NodeOperationResult } from 'react-native-bs-diff-patch/node';",
      "import { createPatchManifest, type PatchManifest } from 'react-native-bs-diff-patch/toolkit';",
      'const input: BinaryInput = new Uint8Array([1, 2, 3]);',
      'void diffBytes(input, input);',
      'void inspectPatch(input).then((value: PatchMetadata) => value.valid);',
      'void verifyPatch(input, input, input).then((value) => value.verified);',
      'void inspectPatchFile("update.patch").then((value) => value.valid);',
      'const manifest: PatchManifest = createPatchManifest({ baseline: { bytes: 1, sha256: "1".repeat(64) }, patch: { bytes: 1, sha256: "2".repeat(64) }, target: { bytes: 1, sha256: "3".repeat(64) } });',
      'const result: NodeOperationResult | undefined = undefined;',
      'const job: BinaryOperationJob = startWebDiff(input, input);',
      'const jobResult: Promise<Uint8Array> = job.result;',
      '// @ts-expect-error Explicit Web types must reject native path arguments.',
      'startWebDiff("old", "new", "patch");',
      'void manifest; void result; void jobResult;',
    ].join('\n')
  );
  run(
    process.execPath,
    [
      path.join(repositoryDirectory, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      'false',
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
