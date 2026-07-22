import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(repositoryDirectory, 'site-dist');
const documentationDirectory = path.join(repositoryDirectory, 'docs');

const requiredFiles = [
  'index.html',
  '404.html',
  'CNAME',
  '.nojekyll',
  'favicon.svg',
  'favicon-32.png',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'site.webmanifest',
  'assets/site.css',
  'assets/site.js',
  'assets/playground.js',
  'assets/tools.js',
  'assets/social-preview.png',
  'web/index.mjs',
  'web/worker.mjs',
  'web/operations.mjs',
  'web/bsdiffpatch.mjs',
  'zh-CN/index.html',
  'tools/index.html',
  'zh-CN/tools/index.html',
  'docs/index.html',
  'docs/getting-started/index.html',
  'docs/api-reference/index.html',
  'docs/recipes/index.html',
  'docs/platform-support/index.html',
  'docs/architecture/index.html',
  'docs/native-operations-v03/index.html',
  'docs/large-files-v04/index.html',
  'docs/troubleshooting/index.html',
  'docs/development/index.html',
  'docs/zh-CN/index.html',
  'docs/zh-CN/getting-started/index.html',
  'docs/zh-CN/api-reference/index.html',
  'docs/zh-CN/recipes/index.html',
  'docs/zh-CN/platform-support/index.html',
  'docs/zh-CN/architecture/index.html',
  'docs/zh-CN/native-operations-v03/index.html',
  'docs/zh-CN/large-files-v04/index.html',
  'docs/zh-CN/troubleshooting/index.html',
  'docs/zh-CN/development/index.html',
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
assert.match(
  await readFile(path.join(outputDirectory, 'sitemap.xml'), 'utf8'),
  /https:\/\/bs-dff-patch\.corerobin\.com\/zh-CN\//
);
assert.match(
  await readFile(path.join(outputDirectory, 'sitemap.xml'), 'utf8'),
  /https:\/\/bs-dff-patch\.corerobin\.com\/tools\//
);
assert.match(
  await readFile(path.join(outputDirectory, 'sitemap.xml'), 'utf8'),
  /https:\/\/bs-dff-patch\.corerobin\.com\/zh-CN\/tools\//
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

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? markdownFiles(entryPath)
        : entry.name.endsWith('.md')
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

const markdownSources = [
  path.join(repositoryDirectory, 'README.md'),
  path.join(repositoryDirectory, 'README.zh-CN.md'),
  path.join(repositoryDirectory, 'CONTRIBUTING.md'),
  ...(await markdownFiles(documentationDirectory)),
];

for (const markdownPath of markdownSources) {
  const markdown = await readFile(markdownPath, 'utf8');
  const references = [...markdown.matchAll(/\]\(([^)]+)\)/g)].map(
    (match) => match[1].split('#')[0]
  );
  for (const reference of references) {
    if (!reference || /^(https?:|mailto:|tel:|\/)/.test(reference)) {
      continue;
    }
    const target = path.resolve(path.dirname(markdownPath), reference);
    assert.ok(
      target.startsWith(`${repositoryDirectory}${path.sep}`),
      `Markdown reference escapes repository: ${reference} in ${markdownPath}`
    );
    await assert.doesNotReject(
      stat(target),
      `broken Markdown reference ${reference} in ${markdownPath}`
    );
  }
}

const homepage = await readFile(
  path.join(outputDirectory, 'index.html'),
  'utf8'
);
assert.match(
  homepage,
  /<meta name="twitter:card" content="summary_large_image"/
);
assert.match(
  homepage,
  /<meta\s+property="og:image"\s+content="https:\/\/bs-dff-patch\.corerobin\.com\/assets\/social-preview\.png"/
);
assert.match(homepage, /<link rel="icon" href="\/favicon\.svg"/);
assert.match(homepage, /<link rel="manifest" href="\/site\.webmanifest"/);
assert.match(
  homepage,
  /<link\s+rel="alternate"\s+hreflang="zh-CN"\s+href="https:\/\/bs-dff-patch\.corerobin\.com\/zh-CN\/"/
);
assert.match(homepage, /id="playground"/);
assert.match(homepage, /id="generate-patch"/);
assert.match(homepage, /id="cancel-operation"/);
assert.match(homepage, /id="max-input-bytes"/);
assert.match(homepage, /id="max-output-bytes"/);
assert.match(homepage, /startPatch/);
assert.match(homepage, /EINPUT_TOO_LARGE/);
assert.match(homepage, /id="evidence"/);
assert.match(homepage, /RN 0\.73\.11/);
assert.match(homepage, /RN 0\.86\.0/);
assert.match(homepage, /133 KiB packed/);
assert.match(homepage, /500 KiB unpacked · 58 files/);
assert.match(homepage, /30,697\.5 ms/);
assert.match(homepage, /assets\/playground\.js/);

const chineseHomepage = await readFile(
  path.join(outputDirectory, 'zh-CN/index.html'),
  'utf8'
);
assert.match(chineseHomepage, /<html lang="zh-CN">/);
assert.match(
  chineseHomepage,
  /<link rel="canonical" href="https:\/\/bs-dff-patch\.corerobin\.com\/zh-CN\/"/
);
assert.match(chineseHomepage, /二进制差量。/);
assert.match(chineseHomepage, /href="\.\.\/docs\/zh-CN\/">文档</);
assert.match(chineseHomepage, /href="\.\.\/"\s+hreflang="en"/);
assert.match(chineseHomepage, /href="\.\.\/assets\/site\.css"/);
assert.doesNotMatch(chineseHomepage, /Binary deltas\./);

const toolsPage = await readFile(
  path.join(outputDirectory, 'tools/index.html'),
  'utf8'
);
assert.match(toolsPage, /<html lang="en">/);
assert.match(
  toolsPage,
  /<link\s+rel="canonical"\s+href="https:\/\/bs-dff-patch\.corerobin\.com\/tools\/"/
);
assert.match(toolsPage, /id="create-panel"/);
assert.match(toolsPage, /id="apply-panel"/);
assert.match(toolsPage, /id="inspect-panel"/);
assert.match(toolsPage, /id="manifest-run"/);
assert.match(toolsPage, /id="savings-target-mib"/);
assert.match(toolsPage, /id="diagnostic-code"/);
assert.match(toolsPage, /id="apply-expected-sha256"/);
assert.match(toolsPage, /id="tool-code"/);
assert.match(toolsPage, /assets\/tools\.js/);
assert.match(toolsPage, /Your files stay in this browser/);

const chineseToolsPage = await readFile(
  path.join(outputDirectory, 'zh-CN/tools/index.html'),
  'utf8'
);
assert.match(chineseToolsPage, /<html lang="zh-CN">/);
assert.match(
  chineseToolsPage,
  /<link\s+rel="canonical"\s+href="https:\/\/bs-dff-patch\.corerobin\.com\/zh-CN\/tools\/"/
);
assert.match(chineseToolsPage, /二进制补丁工具/);
assert.match(chineseToolsPage, /完整性清单/);
assert.match(chineseToolsPage, /传输节省计算器/);
assert.match(chineseToolsPage, /错误码诊断器/);
assert.match(chineseToolsPage, /href="\/tools\/"\s+hreflang="en"/);
assert.doesNotMatch(chineseToolsPage, /\{\{[A-Z0-9_]+\}\}/);

function pngDimensions(buffer) {
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

assert.deepEqual(
  pngDimensions(
    await readFile(path.join(outputDirectory, 'assets/social-preview.png'))
  ),
  { width: 1280, height: 640 }
);
assert.deepEqual(
  pngDimensions(await readFile(path.join(outputDirectory, 'favicon-32.png'))),
  { width: 32, height: 32 }
);
assert.deepEqual(
  pngDimensions(
    await readFile(path.join(outputDirectory, 'apple-touch-icon.png'))
  ),
  { width: 180, height: 180 }
);

const manifest = JSON.parse(
  await readFile(path.join(outputDirectory, 'site.webmanifest'), 'utf8')
);
assert.equal(manifest.theme_color, '#060a0d');
assert.deepEqual(
  manifest.icons.map(({ src, sizes }) => ({ src, sizes })),
  [
    { src: '/icon-192.png', sizes: '192x192' },
    { src: '/icon-512.png', sizes: '512x512' },
  ]
);

console.log('Site structure and local links passed');
