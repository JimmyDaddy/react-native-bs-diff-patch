import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, '..');
const keepTemporaryDirectory = process.env.KEEP_SDK_CONSUMER_DIR === '1';
const temporaryDirectory = await realpath(
  await mkdtemp(
    path.join(os.tmpdir(), 'react-native-bs-diff-patch-sdk-consumers-')
  )
);
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const browserCsp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'";
const registry040TarballUrl =
  'https://registry.npmjs.org/react-native-bs-diff-patch/-/react-native-bs-diff-patch-0.4.0.tgz';
const registry040Integrity =
  'sha512-pQXEVIn9yx8zqYtJjnw2xws3g3EB8E2Qz8N5WTwyUtUSpW/fhBFUtE1ACqbVvW6LE+7ndy7NjlrTJIERD0Y0lQ==';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repositoryDirectory,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', ...options.env },
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stdout || ''}${
        result.stderr || ''
      }`
    );
  }

  return `${result.stdout || ''}${result.stderr || ''}`;
}

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function parseTrailingJson(output) {
  const starts = [0];
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] === '\n') {
      starts.push(index + 1);
    }
  }
  for (const start of starts.reverse()) {
    if (output[start] !== '[' && output[start] !== '{') {
      continue;
    }
    const stack = [];
    let escaped = false;
    let inString = false;
    for (let index = start; index < output.length; index += 1) {
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
            return JSON.parse(output.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error(`JSON document not found in command output:\n${output}`);
}

function packedTarballFilename(metadata) {
  const entries = Array.isArray(metadata) ? metadata : Object.values(metadata);
  if (entries.length !== 1 || typeof entries[0]?.filename !== 'string') {
    throw new Error(
      `Unexpected npm pack metadata:\n${JSON.stringify(metadata)}`
    );
  }
  return entries[0].filename;
}

async function prepareTarball() {
  if (process.env.PACKAGE_TARBALL) {
    const suppliedPath = path.resolve(process.env.PACKAGE_TARBALL);
    await access(suppliedPath);
    return suppliedPath;
  }

  const packageSpec = process.env.PACKAGE_SPEC;
  const metadata = parseTrailingJson(
    run('npm', [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temporaryDirectory,
      ...(packageSpec ? [packageSpec] : []),
    ])
  );
  return path.join(temporaryDirectory, packedTarballFilename(metadata));
}

function readPackedManifest(tarballPath) {
  return JSON.parse(run('tar', ['-xOf', tarballPath, 'package/package.json']));
}

async function prepareRegistry040Tarball() {
  const metadata = parseTrailingJson(
    run('npm', [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temporaryDirectory,
      registry040TarballUrl,
    ])
  );
  const tarballPath = path.join(
    temporaryDirectory,
    packedTarballFilename(metadata)
  );
  const integrity = `sha512-${createHash('sha512')
    .update(await readFile(tarballPath))
    .digest('base64')}`;
  assert.equal(
    integrity,
    registry040Integrity,
    'The cross-version fixture must be the published registry 0.4.0 tarball'
  );
  const manifest = readPackedManifest(tarballPath);
  assert.equal(manifest.name, 'react-native-bs-diff-patch');
  assert.equal(manifest.version, '0.4.0');
  assert.equal(manifest.exports['.'].browser, './web/index.mjs');
  assert.equal(
    Object.hasOwn(manifest.exports, './web'),
    false,
    'Published 0.4.0 is intentionally tested through its root browser entry'
  );
  return tarballPath;
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFiles(candidate)));
    } else {
      results.push(candidate);
    }
  }
  return results;
}

function fromBase64(value) {
  return Buffer.from(value, 'base64');
}

function nativeCliSource() {
  return [
    '#include "bsdiff.h"',
    '#include "bspatch.h"',
    '#include <stdio.h>',
    '#include <string.h>',
    '',
    'int main(int argc, char **argv) {',
    '  if (argc != 5) {',
    '    fprintf(stderr, "usage: native-fixture <diff|patch> <old> <input> <output>\\n");',
    '    return 64;',
    '  }',
    '  if (strcmp(argv[1], "diff") == 0)',
    '    return bsDiffFile(argv[2], argv[3], argv[4]) == 0 ? 0 : 1;',
    '  if (strcmp(argv[1], "patch") == 0)',
    '    return bsPatchFile(argv[2], argv[4], argv[3]) == 0 ? 0 : 1;',
    '  fprintf(stderr, "unknown operation: %s\\n", argv[1]);',
    '  return 64;',
    '}',
    '',
  ].join('\n');
}

async function buildNativeFixture() {
  const fixtureDirectory = path.join(temporaryDirectory, 'native-fixture');
  const sourcePath = path.join(fixtureDirectory, 'native-fixture.c');
  const executablePath = path.join(fixtureDirectory, 'native-fixture');
  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(sourcePath, nativeCliSource());

  const sources = [
    'cpp/bsdiff.c',
    'cpp/bspatch.c',
    'cpp/bspatch_streaming.c',
    'cpp/bzlib/blocksort.c',
    'cpp/bzlib/bzlib.c',
    'cpp/bzlib/compress.c',
    'cpp/bzlib/crctable.c',
    'cpp/bzlib/decompress.c',
    'cpp/bzlib/huffman.c',
    'cpp/bzlib/randtable.c',
  ].map((source) => path.join(repositoryDirectory, source));
  const featureTestMacro =
    process.platform === 'darwin'
      ? '-D_DARWIN_C_SOURCE'
      : '-D_POSIX_C_SOURCE=200809L';

  run('cc', [
    '-std=c11',
    featureTestMacro,
    '-O2',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-Wno-implicit-fallthrough',
    '-Wno-unused-parameter',
    '-I',
    path.join(repositoryDirectory, 'cpp'),
    sourcePath,
    ...sources,
    '-o',
    executablePath,
  ]);
  return executablePath;
}

function createBrowserEntry({ importPath, includeToolkit, includeProgress }) {
  const imports = ['diffBytes', 'inspectPatch', 'patchBytes', 'verifyPatch'];
  if (includeToolkit) {
    imports.push('startDiffBytes');
  }
  const lines = [`import { ${imports.join(', ')} } from '${importPath}';`];
  if (includeToolkit) {
    lines.push(
      "import { canonicalJson, createPatchManifest } from 'react-native-bs-diff-patch/toolkit';"
    );
  }
  lines.push(
    'const sdkWindow = window as typeof window & {',
    '  __bsdiffSdkConsumer: Promise<{ patch: string; old: string; target: string; patchBytes: number; outputLimitCode: string | undefined }>;',
    '  __bsdiffSdkApplyPatch: (patchBase64: string) => Promise<string>;',
    '};',
    'const encoder = new TextEncoder();',
    "const oldData = encoder.encode('SDK consumer old payload\\n'.repeat(96));",
    "const newData = encoder.encode('SDK consumer new payload\\n'.repeat(64) + 'additional verified content\\n'.repeat(32));",
    'const oldSnapshot = oldData.slice();',
    'function sameBytes(left: Uint8Array, right: Uint8Array): boolean {',
    '  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);',
    '}',
    'function toBase64(value: Uint8Array): string {',
    '  let result = "";',
    '  for (let index = 0; index < value.length; index += 1) result += String.fromCharCode(value[index]!);',
    '  return btoa(result);',
    '}',
    'function fromBase64(value: string): Uint8Array {',
    '  const decoded = atob(value);',
    '  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));',
    '}',
    'async function expectError(operation: () => Promise<unknown>): Promise<string | undefined> {',
    '  try { await operation(); return undefined; } catch (error: unknown) { return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined; }',
    '}',
    'async function run() {',
    ...(includeProgress
      ? [
          "  const progress: Array<{ operation: 'diff' | 'patch'; phase: 'reading' | 'processing' | 'writing'; progress: number }> = [];",
          '  const patch = await diffBytes(oldData, newData, { onProgress: (event) => progress.push(event) });',
        ]
      : ['  const patch = await diffBytes(oldData, newData);']),
    '  const restored = await patchBytes(oldData, patch);',
    '  const metadata = await inspectPatch(patch);',
    '  const verified = await verifyPatch(oldData, patch, newData);',
    '  const wrongBaseline = await verifyPatch(encoder.encode("wrong baseline"), patch, newData);',
    '  const invalidHeader = await inspectPatch(new Uint8Array([66, 83, 68, 73, 70, 70, 52, 48]));',
    '  const outputLimitCode = await expectError(() => patchBytes(oldData, patch, { maxOutputBytes: newData.byteLength - 1 }));',
    '  const concurrent = await Promise.all([diffBytes(oldData, newData), diffBytes(oldData, newData)]);',
    `  if (!sameBytes(restored, newData) || !sameBytes(oldData, oldSnapshot) || !verified.verified || wrongBaseline.verified || metadata.format !== "ENDSLEY/BSDIFF43" || !metadata.valid || invalidHeader.format !== "BSDIFF40" || invalidHeader.valid || outputLimitCode !== "ERESOURCE" || !sameBytes(concurrent[0], patch) || !sameBytes(concurrent[1], patch)${
      includeProgress
        ? ' || !progress.some((event) => event.phase === "processing" && event.progress > 0)'
        : ''
    }) {`,
    '    throw new Error("SDK Web consumer assertions failed");',
    '  }'
  );
  if (includeToolkit) {
    lines.push(
      '  const cancelledJob = startDiffBytes(oldData, newData);',
      '  await cancelledJob.cancel();',
      '  await cancelledJob.cancel();',
      '  const cancelledCode = await expectError(() => cancelledJob.result);',
      '  const nextResult = await startDiffBytes(oldData, newData).result;',
      '  if (cancelledCode !== "EABORTED" || !sameBytes(nextResult, patch)) throw new Error("Task cancellation consumer assertions failed");',
      '  const manifest = createPatchManifest({ baseline: { bytes: oldData.byteLength, sha256: "1".repeat(64) }, patch: { bytes: patch.byteLength, sha256: "2".repeat(64) }, target: { bytes: newData.byteLength, sha256: "3".repeat(64) } });',
      '  if (canonicalJson({ b: 1, a: 2 }) !== "{\\"a\\":2,\\"b\\":1}" || manifest.version !== 1) throw new Error("Toolkit consumer assertions failed");'
    );
  }
  lines.push(
    '  return {',
    '    patch: toBase64(patch),',
    '    old: toBase64(oldData),',
    '    target: toBase64(newData),',
    '    patchBytes: patch.byteLength,',
    '    outputLimitCode,',
    '  };',
    '}',
    'sdkWindow.__bsdiffSdkConsumer = run();',
    'sdkWindow.__bsdiffSdkApplyPatch = async (patchBase64) => {',
    '  const restored = await patchBytes(oldData, fromBase64(patchBase64));',
    '  return toBase64(restored);',
    '};',
    ''
  );
  return lines.join('\n');
}

async function writeConsumer({
  name,
  packageSpec,
  importPath,
  includeToolkit,
  includeProgress,
}) {
  const directory = path.join(temporaryDirectory, name);
  await mkdir(path.join(directory, 'src'), { recursive: true });
  await writeFile(
    path.join(directory, 'package.json'),
    `${JSON.stringify(
      {
        name: `${name}-consumer`,
        private: true,
        type: 'module',
        devDependencies: {
          typescript: '5.8.3',
          vite: '7.1.0',
        },
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(directory, 'index.html'),
    '<main id="app">SDK consumer</main><script type="module" src="/src/main.ts"></script>\n'
  );
  await writeFile(
    path.join(directory, 'vite.config.mjs'),
    [
      "import { defineConfig } from 'vite';",
      'export default defineConfig({',
      "  build: { target: 'es2022' },",
      "  worker: { format: 'es' },",
      '});',
      '',
    ].join('\n')
  );
  await writeFile(
    path.join(directory, 'src', 'main.ts'),
    createBrowserEntry({ importPath, includeToolkit, includeProgress })
  );
  if (includeToolkit) {
    await writeFile(
      path.join(directory, 'src', 'browser-types.ts'),
      [
        "import { startDiff as startRootDiff } from 'react-native-bs-diff-patch';",
        "import { startDiff as startWebDiff, type BinaryOperationJob } from 'react-native-bs-diff-patch/web';",
        'const input = new Uint8Array([1, 2, 3]);',
        'const rootJob: BinaryOperationJob = startRootDiff(input, input);',
        'const webJob: BinaryOperationJob = startWebDiff(input, input);',
        'const rootResult: Promise<Uint8Array> = rootJob.result;',
        'const webResult: Promise<Uint8Array> = webJob.result;',
        '// @ts-expect-error Browser root types must reject native path arguments.',
        "startRootDiff('old.bin', 'new.bin', 'update.patch');",
        '// @ts-expect-error The explicit /web entry must reject native path arguments.',
        "startWebDiff('old.bin', 'new.bin', 'update.patch');",
        'void rootResult; void webResult;',
        '',
      ].join('\n')
    );
    await writeFile(
      path.join(directory, 'src', 'native-types.ts'),
      [
        "import { startDiff } from 'react-native-bs-diff-patch';",
        "import type { NativeOperationJob } from 'react-native-bs-diff-patch';",
        "const nativeJob: NativeOperationJob = startDiff('old.bin', 'new.bin', 'update.patch');",
        'const nativeResult: Promise<number> = nativeJob.result;',
        'void nativeResult;',
        '',
      ].join('\n')
    );
    await writeFile(
      path.join(directory, 'tsconfig.browser.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            customConditions: ['browser'],
            lib: ['ES2022', 'DOM'],
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            skipLibCheck: false,
            strict: true,
            target: 'ES2022',
          },
          include: ['src/main.ts', 'src/browser-types.ts'],
        },
        null,
        2
      )}\n`
    );
    await writeFile(
      path.join(directory, 'tsconfig.native.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            lib: ['ES2022', 'DOM'],
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            skipLibCheck: false,
            strict: true,
            target: 'ES2022',
          },
          include: ['src/native-types.ts'],
        },
        null,
        2
      )}\n`
    );
  }

  run(
    'npm',
    ['install', '--no-audit', '--no-fund', '--prefer-offline', packageSpec],
    { cwd: directory }
  );

  assert.equal(
    await pathExists(path.join(directory, 'node_modules/react-native')),
    false,
    `${name} must not install React Native`
  );
  assert.equal(
    await pathExists(path.join(directory, 'node_modules/react')),
    false,
    `${name} must not install React`
  );
  const installedTree = JSON.parse(
    run('npm', ['ls', '--all', '--omit=dev', '--json'], { cwd: directory })
  );
  assert.equal(
    Object.hasOwn(installedTree.dependencies || {}, 'react-native'),
    false,
    `${name} dependency tree must not contain React Native`
  );

  if (includeToolkit) {
    const typecheck = run(
      process.execPath,
      [
        path.join(directory, 'node_modules/typescript/bin/tsc'),
        '-p',
        'tsconfig.browser.json',
      ],
      { cwd: directory }
    );
    assert.equal(typecheck, '', `${name} TypeScript consumer emitted output`);
    const nativeTypecheck = run(
      process.execPath,
      [
        path.join(directory, 'node_modules/typescript/bin/tsc'),
        '-p',
        'tsconfig.native.json',
      ],
      { cwd: directory }
    );
    assert.equal(
      nativeTypecheck,
      '',
      `${name} native TypeScript consumer emitted output`
    );
  }
  const buildOutput = run(
    process.execPath,
    [path.join(directory, 'node_modules/vite/bin/vite.js'), 'build'],
    { cwd: directory }
  );

  assert.equal(
    await pathExists(path.join(directory, 'dist', 'index.html')),
    true,
    `${name} Vite consumer did not build`
  );
  return { buildOutput, directory };
}

async function serveDirectory(directory) {
  const mimeTypes = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.wasm', 'application/wasm'],
  ]);
  const root = path.resolve(directory);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url || '/', 'http://127.0.0.1').pathname
      );
      const requestedPath = path.resolve(root, `.${pathname}`);
      if (
        requestedPath !== root &&
        !requestedPath.startsWith(`${root}${path.sep}`)
      ) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const filePath =
        pathname === '/' ? path.join(root, 'index.html') : requestedPath;
      if (!(await stat(filePath)).isFile()) {
        response.writeHead(404).end('Not Found');
        return;
      }
      response.writeHead(200, {
        'Content-Security-Policy': browserCsp,
        'Content-Type':
          mimeTypes.get(path.extname(filePath)) || 'application/octet-stream',
      });
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404).end('Not Found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function runBrowserConsumer(browser, directory, name) {
  const server = await serveDirectory(path.join(directory, 'dist'));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const requests = [];
  const blockedRequests = [];
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(origin)) {
      requests.push({ type: request.resourceType(), url });
      void request.continue();
      return;
    }
    blockedRequests.push(url);
    void request.abort();
  });

  try {
    const documentResponse = await page.goto(origin, {
      waitUntil: 'networkidle0',
    });
    assert.equal(
      documentResponse?.headers()['content-security-policy'],
      browserCsp,
      `${name} did not receive the strict production CSP`
    );
    const result = await page.evaluate(async () => window.__bsdiffSdkConsumer);
    assert.equal(result.outputLimitCode, 'ERESOURCE');
    assert.ok(result.patchBytes > 24, `${name} did not produce a patch`);
    assert.equal(
      blockedRequests.length,
      0,
      `${name} tried to access a non-local resource: ${blockedRequests.join(
        ', '
      )}`
    );
    assert.ok(
      requests.length >= 3,
      `${name} did not load a Worker resource from the production bundle`
    );
    return {
      ...result,
      resourceUrls: requests.map(({ url }) => url),
      async applyPatch(patchBase64) {
        return page.evaluate(
          (encoded) => window.__bsdiffSdkApplyPatch(encoded),
          patchBase64
        );
      },
      close: async () => {
        await page.close();
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      },
    };
  } catch (error) {
    await page.close();
    await new Promise((resolve, reject) =>
      server.close((closeError) =>
        closeError ? reject(closeError) : resolve()
      )
    );
    throw error;
  }
}

async function assertPackContract(tarballPath) {
  const tarEntries = run('tar', ['-tf', tarballPath]);
  for (const entry of [
    'package/web/index.mjs',
    'package/web/index.d.mts',
    'package/web/worker.mjs',
    'package/web/bsdiffpatch.browser.mjs',
    'package/toolkit/index.mjs',
    'package/toolkit/index.d.ts',
  ]) {
    assert.match(
      tarEntries,
      new RegExp(`^${entry}$`, 'm'),
      `${entry} is absent`
    );
  }
  assert.doesNotMatch(tarEntries, /^package\/web\/progress_bridge\.c$/m);
}

async function assertManifestContract(consumerDirectory, expectedVersion) {
  const manifest = JSON.parse(
    await readFile(
      path.join(
        consumerDirectory,
        'node_modules/react-native-bs-diff-patch/package.json'
      ),
      'utf8'
    )
  );
  assert.equal(manifest.version, expectedVersion);
  assert.equal(manifest.exports['./web'].import, './web/index.mjs');
  assert.equal(manifest.exports['./web'].types, './web/index.d.mts');
  assert.equal(manifest.exports['./toolkit'].import, './toolkit/index.mjs');
  assert.equal(manifest.exports['./toolkit'].types, './toolkit/index.d.ts');
  assert.equal(
    Object.hasOwn(manifest.exports['./web'], 'require'),
    false,
    'The ESM-only /web entry must not claim CommonJS support'
  );
  assert.equal(
    Object.hasOwn(manifest.exports['./toolkit'], 'require'),
    false,
    'The ESM-only /toolkit entry must not claim CommonJS support'
  );
}

async function assertNoNodeRuntimeInBuild(directory, buildOutput) {
  assert.doesNotMatch(
    buildOutput,
    /externalized for browser compatibility/i,
    'Vite externalized a Node runtime import from the formal /web entry'
  );
  const files = await listFiles(path.join(directory, 'dist'));
  const source = await Promise.all(
    files
      .filter((filename) => /\.(?:js|mjs)$/i.test(filename))
      .map((filename) => readFile(filename, 'utf8'))
  );
  assert.ok(
    source.some((value) => value.includes('new Worker')),
    'The production bundle did not retain a Worker constructor'
  );
  assert.equal(
    source.some((value) =>
      /['"]node:|NODEFS|require\(['"](?:fs|path|node:)/.test(value)
    ),
    false,
    'The production /web bundle still contains a Node runtime branch'
  );
}

try {
  const executablePath = chromeCandidates.find((candidate) =>
    existsSync(candidate)
  );
  if (!executablePath) {
    throw new Error(
      'Chrome executable not found; set CHROME_PATH to run the SDK consumer test'
    );
  }

  const tarballPath = await prepareTarball();
  await assertPackContract(tarballPath);
  const packedManifest = readPackedManifest(tarballPath);
  assert.equal(packedManifest.name, 'react-native-bs-diff-patch');
  const tarballIntegrity = createHash('sha512')
    .update(await readFile(tarballPath))
    .digest('base64');

  const current = await writeConsumer({
    name: 'current-vite',
    packageSpec: tarballPath,
    importPath: 'react-native-bs-diff-patch/web',
    includeToolkit: true,
    includeProgress: true,
  });
  await assertManifestContract(current.directory, packedManifest.version);
  await assertNoNodeRuntimeInBuild(current.directory, current.buildOutput);

  const registryTarballPath = await prepareRegistry040Tarball();
  const registry = await writeConsumer({
    name: 'registry-v040-vite',
    packageSpec: registryTarballPath,
    importPath: 'react-native-bs-diff-patch',
    includeToolkit: false,
    includeProgress: false,
  });

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--disable-background-networking',
      '--disable-dev-shm-usage',
      '--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE 127.0.0.1',
    ],
  });
  let currentBrowser;
  let registryBrowser;
  try {
    currentBrowser = await runBrowserConsumer(
      browser,
      current.directory,
      `${packedManifest.version} /web`
    );
    registryBrowser = await runBrowserConsumer(
      browser,
      registry.directory,
      'registry 0.4.0 root browser'
    );

    assert.deepEqual(
      fromBase64(await currentBrowser.applyPatch(registryBrowser.patch)),
      fromBase64(currentBrowser.target),
      `${packedManifest.version} /web did not restore a registry 0.4.0 patch`
    );
    assert.deepEqual(
      fromBase64(await registryBrowser.applyPatch(currentBrowser.patch)),
      fromBase64(registryBrowser.target),
      `registry 0.4.0 did not restore a ${packedManifest.version} /web patch`
    );

    const nativeCli = await buildNativeFixture();
    const fixtureDirectory = path.join(temporaryDirectory, 'native-cross');
    const oldPath = path.join(fixtureDirectory, 'old.bin');
    const targetPath = path.join(fixtureDirectory, 'target.bin');
    const currentPatchPath = path.join(fixtureDirectory, 'current.patch');
    const registryPatchPath = path.join(fixtureDirectory, 'registry.patch');
    const nativePatchPath = path.join(fixtureDirectory, 'native.patch');
    const restoredCurrentPath = path.join(
      fixtureDirectory,
      'restored-current.bin'
    );
    const restoredRegistryPath = path.join(
      fixtureDirectory,
      'restored-registry.bin'
    );
    await mkdir(fixtureDirectory, { recursive: true });
    await Promise.all([
      writeFile(oldPath, fromBase64(currentBrowser.old)),
      writeFile(targetPath, fromBase64(currentBrowser.target)),
      writeFile(currentPatchPath, fromBase64(currentBrowser.patch)),
      writeFile(registryPatchPath, fromBase64(registryBrowser.patch)),
    ]);
    run(nativeCli, ['patch', oldPath, currentPatchPath, restoredCurrentPath]);
    run(nativeCli, ['patch', oldPath, registryPatchPath, restoredRegistryPath]);
    assert.deepEqual(
      await readFile(restoredCurrentPath),
      await readFile(targetPath)
    );
    assert.deepEqual(
      await readFile(restoredRegistryPath),
      await readFile(targetPath)
    );
    run(nativeCli, ['diff', oldPath, targetPath, nativePatchPath]);
    assert.deepEqual(
      fromBase64(
        await currentBrowser.applyPatch(
          (await readFile(nativePatchPath)).toString('base64')
        )
      ),
      await readFile(targetPath),
      `${packedManifest.version} /web did not restore a native-generated patch`
    );
    assert.deepEqual(
      fromBase64(
        await registryBrowser.applyPatch(
          (await readFile(nativePatchPath)).toString('base64')
        )
      ),
      await readFile(targetPath),
      'registry 0.4.0 did not restore a native-generated patch'
    );
  } finally {
    await registryBrowser?.close();
    await currentBrowser?.close();
    await browser.close();
  }

  console.log(
    `SDK consumers passed: version=${
      packedManifest.version
    } tarball=${tarballPath} sha512-${tarballIntegrity} registry040=${registry040Integrity} retained=${
      keepTemporaryDirectory ? temporaryDirectory : 'no'
    }`
  );
  console.log(
    `SDK browser evidence: csp=${browserCsp} currentResources=${JSON.stringify(
      currentBrowser.resourceUrls
    )} registryResources=${JSON.stringify(registryBrowser.resourceUrls)}`
  );
} finally {
  if (keepTemporaryDirectory) {
    console.log(`SDK consumer artifacts retained at ${temporaryDirectory}`);
  } else {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
