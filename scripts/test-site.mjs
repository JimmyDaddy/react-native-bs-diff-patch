import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(repositoryDirectory, 'site-dist');

const requiredFiles = [
  'index.html',
  '404.html',
  'CNAME',
  '.nojekyll',
  'assets/site.css',
  'assets/site.js',
  'assets/playground.js',
  'web/index.mjs',
  'web/worker.mjs',
  'web/operations.mjs',
  'web/bsdiffpatch.mjs',
  'docs/index.html',
  'docs/getting-started/index.html',
  'docs/api-reference/index.html',
  'docs/platform-support/index.html',
  'docs/architecture/index.html',
  'docs/troubleshooting/index.html',
  'docs/development/index.html',
];

for (const relativePath of requiredFiles) {
  assert.ok(
    (await stat(path.join(outputDirectory, relativePath))).isFile(),
    `missing site output: ${relativePath}`
  );
}

assert.equal(
  (await readFile(path.join(outputDirectory, 'CNAME'), 'utf8')).trim(),
  'bs-dff-patch.corerobin.com'
);

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? htmlFiles(entryPath)
        : entry.name.endsWith('.html')
        ? [entryPath]
        : [];
    })
  );
  return nested.flat();
}

function resolveLocalReference(htmlPath, reference) {
  const cleaned = reference.split('#')[0].split('?')[0];
  if (!cleaned || /^(https?:|mailto:|tel:|data:)/.test(cleaned)) {
    return undefined;
  }
  const candidate = cleaned.startsWith('/')
    ? path.join(outputDirectory, cleaned)
    : path.resolve(path.dirname(htmlPath), cleaned);
  if (path.extname(candidate)) {
    return candidate;
  }
  return path.join(candidate, 'index.html');
}

for (const htmlPath of await htmlFiles(outputDirectory)) {
  const html = await readFile(htmlPath, 'utf8');
  assert.doesNotMatch(
    html,
    /\{\{[A-Z_]+\}\}/,
    `unresolved token in ${htmlPath}`
  );
  assert.match(
    html,
    /<meta name="viewport"/,
    `missing viewport in ${htmlPath}`
  );

  const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(
    (match) => match[1]
  );
  for (const reference of references) {
    const target = resolveLocalReference(htmlPath, reference);
    if (target) {
      assert.ok(
        (await stat(target)).isFile(),
        `broken local reference ${reference} in ${htmlPath}`
      );
    }
  }
}

const homepage = await readFile(
  path.join(outputDirectory, 'index.html'),
  'utf8'
);
assert.match(homepage, /id="playground"/);
assert.match(homepage, /id="generate-patch"/);
assert.match(homepage, /assets\/playground\.js/);

console.log('Site structure and local links passed');
