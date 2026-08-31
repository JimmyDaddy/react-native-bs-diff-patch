import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8')
);
const rootExport = manifest.exports['.'];
assert.equal(rootExport.browser, './web/index.mjs');
assert.equal(rootExport['react-native'], './src/index.ts');
assert.equal(rootExport.import, './lib/module/index.js');
assert.equal(rootExport.require, './lib/commonjs/index.js');
assert.equal(rootExport.types.browser, './web/index.d.mts');
assert.equal(rootExport.types['react-native'], rootExport.types.default);
assert.equal(manifest.exports['./web'].types, './web/index.d.mts');
assert.equal(manifest.exports['./web'].import, './web/index.mjs');
assert.equal(manifest.exports['./toolkit'].import, './toolkit/index.mjs');
assert.equal(manifest.exports['./node'].node, './node/index.mjs');
assert.equal(manifest.peerDependenciesMeta.react.optional, true);
assert.equal(manifest.peerDependenciesMeta['react-native'].optional, true);

async function checkExportTargets(value) {
  if (typeof value === 'string') {
    assert.ok(
      value.startsWith('./'),
      `Export target must be package-relative: ${value}`
    );
    await access(path.join(root, value));
  } else if (value && typeof value === 'object') {
    for (const target of Object.values(value)) await checkExportTargets(target);
  }
}
await checkExportTargets(manifest.exports);
for (const directory of ['web', 'toolkit', 'node', 'bin', 'action']) {
  assert.ok(manifest.files.includes(directory), `${directory} must be packed`);
}
for (const relative of [
  'web/bsdiffpatch.mjs',
  'web/bsdiffpatch.browser.mjs',
  'action.yml',
  'action/index.mjs',
  'bin/react-native-bs-diff-patch.mjs',
])
  await access(path.join(root, relative));

// Follow real imports and module Worker URL literals, including generated JS.
// No aliases, externals or shims can satisfy this source-graph contract.
const visited = new Set();
async function checkBrowserGraph(relative) {
  const absolute = path.resolve(root, relative);
  if (visited.has(absolute)) return;
  visited.add(absolute);
  const source = await readFile(absolute, 'utf8');
  assert.doesNotMatch(
    source,
    /['"]node:|\bNODEFS\b|\bENVIRONMENT_IS_NODE\b|\b__dirname\b|\brequire\s*\(/,
    `Browser dependency contains a Node runtime branch: ${relative}`
  );
  for (const match of source.matchAll(/['"](\.\.?\/[^'"\n]+\.mjs)['"]/g)) {
    await checkBrowserGraph(
      path.relative(root, path.resolve(path.dirname(absolute), match[1]))
    );
  }
}
await checkBrowserGraph('web/index.mjs');
assert.ok(
  visited.has(path.join(root, 'web/bsdiffpatch.browser.mjs')),
  'The public Web entry must reach the dedicated browser build'
);
assert.ok(
  !visited.has(path.join(root, 'web/bsdiffpatch.mjs')),
  'The public Web entry must not reach the Node-compatible build'
);
assert.match(
  await readFile(path.join(root, 'node/index.mjs'), 'utf8'),
  /web\/bsdiffpatch\.mjs/
);
assert.match(
  await readFile(path.join(root, 'web/bsdiffpatch.mjs'), 'utf8'),
  /NODEFS/
);

for (const [entry, declaration] of [
  ['web/index.mjs', 'web/index.d.mts'],
  ['toolkit/index.mjs', 'toolkit/index.d.ts'],
]) {
  const api = await import(pathToFileURL(path.join(root, entry)).href);
  const types = await readFile(path.join(root, declaration), 'utf8');
  for (const name of Object.keys(api)) {
    assert.match(
      types,
      new RegExp(`export (?:declare )?(?:function|class|const) ${name}\\b`),
      `${entry} export ${name} must have a public declaration`
    );
  }
}
console.log(
  `Package ${manifest.version}: exports, public declarations, assets and Node-free browser graph passed`
);
