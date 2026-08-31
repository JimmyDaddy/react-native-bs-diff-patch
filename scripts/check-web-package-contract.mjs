import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertDeclarationValueExportsMatchRuntime,
  declarationExports,
} from './declaration-contract.mjs';
import {
  packageExports,
  packageFileMappings,
  repositoryDirectory,
  sourcePackageDirectory,
  stagedPackageFiles,
  stagingPackageDirectory,
  webRuntimeModuleFiles,
} from './web-package-layout.mjs';

async function listFiles(directory, relative = '') {
  const entries = await readdir(path.join(directory, relative), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, entryRelative)));
    } else if (entry.isFile()) {
      files.push(entryRelative);
    } else {
      throw new Error(`Unexpected non-file package entry: ${entryRelative}`);
    }
  }
  return files;
}

const numericSemverIdentifier = '(?:0|[1-9]\\d*)';
const prereleaseSemverIdentifier = `(?:${numericSemverIdentifier}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const semverVersion = new RegExp(
  `^${numericSemverIdentifier}\\.${numericSemverIdentifier}\\.${numericSemverIdentifier}` +
    `(?:-${prereleaseSemverIdentifier}(?:\\.${prereleaseSemverIdentifier})*)?` +
    '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$'
);

function parsePackResult(output) {
  const starts = [0];
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] === '\n') {
      starts.push(index + 1);
    }
  }
  for (const start of starts.reverse()) {
    const opening = output[start];
    if (opening !== '[' && opening !== '{') continue;
    const stack = [opening === '[' ? ']' : '}'];
    let escaped = false;
    let inString = false;
    for (let index = start + 1; index < output.length; index += 1) {
      const character = output[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === '[') {
        stack.push(']');
      } else if (character === '{') {
        stack.push('}');
      } else if (character === stack.at(-1)) {
        stack.pop();
        if (stack.length === 0) {
          try {
            const result = JSON.parse(output.slice(start, index + 1));
            if (Array.isArray(result)) return result;
            if (Array.isArray(result.files)) return [result];
            const records = Object.values(result);
            if (records.every((record) => Array.isArray(record?.files))) {
              return records;
            }
          } catch {
            // Try an earlier JSON-looking line instead.
          }
          break;
        }
      }
    }
  }
  throw new Error(`npm pack did not return JSON:\n${output}`);
}

async function checkModuleGraph(entry) {
  const visited = new Set();
  async function visit(relative) {
    if (visited.has(relative)) return;
    visited.add(relative);
    const source = await readFile(
      path.join(stagingPackageDirectory, relative),
      'utf8'
    );
    assert.doesNotMatch(
      source,
      /['"]node:|\bNODEFS\b|\bENVIRONMENT_IS_NODE\b|\b__dirname\b|\brequire\s*\(|(?:from\s+|import\s*)['"]react-native(?:\/|['"])/,
      `Browser package dependency is not browser-only: ${relative}`
    );
    for (const match of source.matchAll(/['"](\.\.?\/[^'"\n]+\.mjs)['"]/g)) {
      const dependency = path.posix.normalize(
        path.posix.join(path.posix.dirname(relative), match[1])
      );
      await visit(dependency);
    }
  }
  await visit(entry);
  return visited;
}

const sourceManifest = JSON.parse(
  await readFile(path.join(sourcePackageDirectory, 'package.json'), 'utf8')
);
const stagingManifest = JSON.parse(
  await readFile(path.join(stagingPackageDirectory, 'package.json'), 'utf8')
);

assert.equal(sourceManifest.name, 'bs-diff-patch-web');
assert.match(
  sourceManifest.version,
  semverVersion,
  'packages/web/package.json version must be a valid SemVer version'
);
assert.equal(sourceManifest.private, true);
assert.deepEqual(sourceManifest.exports, packageExports);
assert.deepEqual(sourceManifest.publishConfig, {
  registry: 'https://registry.npmjs.org/',
  access: 'public',
});
const thirdPartyNotices = await readFile(
  path.join(sourcePackageDirectory, 'THIRD_PARTY_NOTICES.txt'),
  'utf8'
);
for (const requiredNotice of [
  'Copyright 2003-2005 Colin Percival',
  'Copyright 2012 Matthew Endsley',
  'bzip2/libbzip2 version 1.0.6 of 6 September 2010',
  'Copyright (c) 2010-2014 Emscripten authors',
  'Copyright © 2005-2020 Rich Felker, et al.',
]) {
  assert.ok(
    thirdPartyNotices.includes(requiredNotice),
    `THIRD_PARTY_NOTICES.txt is missing: ${requiredNotice}`
  );
}
assert.deepEqual(sourceManifest.exports, stagingManifest.exports);
assert.equal(stagingManifest.private, undefined);
assert.equal(stagingManifest.scripts, undefined);
assert.equal(stagingManifest.types, './index.d.mts');
assert.deepEqual(stagingManifest.publishConfig, sourceManifest.publishConfig);
assert.ok(
  stagedPackageFiles.includes('THIRD_PARTY_NOTICES.txt'),
  'Standalone Web package must include its third-party notices'
);
for (const forbiddenField of [
  'bin',
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'react-native',
]) {
  assert.equal(
    stagingManifest[forbiddenField],
    undefined,
    `Staging manifest must not contain ${forbiddenField}`
  );
}
assert.equal(stagingManifest.name, sourceManifest.name);
assert.equal(stagingManifest.version, sourceManifest.version);
assert.equal(stagingManifest.type, 'module');

assert.deepEqual(
  (await listFiles(stagingPackageDirectory)).sort(),
  stagedPackageFiles,
  'Staging package file set changed'
);

for (const mapping of packageFileMappings) {
  assert.deepEqual(
    await readFile(path.join(stagingPackageDirectory, mapping.to)),
    await readFile(path.join(repositoryDirectory, mapping.from)),
    `Staged ${mapping.to} differs from ${mapping.from}`
  );
}

const webGraph = await checkModuleGraph('index.mjs');
assert.deepEqual(
  [...webGraph].sort(),
  webRuntimeModuleFiles.slice().sort(),
  'Web export graph must contain exactly the browser runtime'
);
const toolkitGraph = await checkModuleGraph('toolkit/index.mjs');
assert.deepEqual(
  [...toolkitGraph],
  ['toolkit/index.mjs'],
  'Toolkit export graph must be self-contained'
);

for (const [entry, declaration, sourceDirectory] of [
  ['index.mjs', 'index.d.mts'],
  ['toolkit/index.mjs', 'toolkit/index.d.ts', repositoryDirectory],
]) {
  const staged = await import(
    pathToFileURL(path.join(stagingPackageDirectory, entry)).href
  );
  if (sourceDirectory) {
    const source = await import(
      pathToFileURL(path.join(sourceDirectory, entry)).href
    );
    assert.deepEqual(
      Object.keys(staged).sort(),
      Object.keys(source).sort(),
      `Staged ${entry} public API differs from source`
    );
  }
  const declarationSource = await readFile(
    path.join(stagingPackageDirectory, declaration),
    'utf8'
  );
  assertDeclarationValueExportsMatchRuntime(
    staged,
    declarationSource,
    declaration
  );
  if (entry === 'index.mjs') {
    const facadeDeclarations = declarationExports(
      declarationSource,
      declaration
    );
    for (const forbiddenExport of [
      'diff',
      'patch',
      'NativeOperationJob',
      'NativeOperationOptions',
      'NativeOperationProgress',
    ]) {
      assert.ok(
        !Object.hasOwn(staged, forbiddenExport) &&
          !facadeDeclarations.includes(forbiddenExport),
        `Standalone Web facade must not export ${forbiddenExport}`
      );
    }
  }
}

const packed = spawnSync(
  'npm',
  ['pack', '--dry-run', '--ignore-scripts', '--json'],
  { cwd: stagingPackageDirectory, encoding: 'utf8' }
);
if (packed.status !== 0) {
  throw new Error(
    `npm pack failed:\n${packed.stdout || ''}${packed.stderr || ''}`
  );
}
const packResult = parsePackResult(packed.stdout);
assert.equal(packResult.length, 1, 'npm pack returned an unexpected result');
assert.deepEqual(
  packResult[0].files.map((file) => file.path).sort(),
  stagedPackageFiles,
  'npm tarball file set changed'
);

console.log(
  `Web package ${stagingManifest.name}@${stagingManifest.version}: browser graph, bytes, API types and tarball contract passed`
);
