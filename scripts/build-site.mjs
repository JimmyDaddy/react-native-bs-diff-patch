import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, '..');
const siteDirectory = path.join(repositoryDirectory, 'site');
const outputDirectory = path.join(repositoryDirectory, 'site-dist');
const docsDirectory = path.join(repositoryDirectory, 'docs');

const pages = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    description:
      'Install the package and complete your first native or Web patch round trip.',
    file: 'getting-started.md',
  },
  {
    slug: 'api-reference',
    title: 'API reference',
    description:
      'Signatures, accepted inputs, return values, errors, and concurrency behavior.',
    file: 'api-reference.md',
  },
  {
    slug: 'platform-support',
    title: 'Platform support',
    description:
      'Android, iOS, New Architecture, React Native Web, Metro, and browser requirements.',
    file: 'platform-support.md',
  },
  {
    slug: 'architecture',
    title: 'Architecture',
    description:
      'Execution boundaries, the shared C core, WebAssembly packaging, and patch compatibility.',
    file: 'architecture.md',
  },
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting',
    description:
      'Resolve native registration, filesystem, Worker, WebAssembly, and patch-format failures.',
    file: 'troubleshooting.md',
  },
  {
    slug: 'development',
    title: 'Development',
    description:
      'Repository setup, native and Web gates, site checks, WebAssembly builds, and releases.',
    file: 'development.md',
  },
];

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeDocumentationLink(href) {
  const markdownMatch = href.match(/^\.\/([a-z-]+)\.md(#[\w-]+)?$/);
  if (markdownMatch) {
    return `/docs/${markdownMatch[1]}/${markdownMatch[2] || ''}`;
  }
  if (href === '../CONTRIBUTING.md') {
    return 'https://github.com/JimmyDaddy/react-native-bs-diff-patch/blob/main/CONTRIBUTING.md';
  }
  return href;
}

function renderInline(value) {
  const codeTokens = [];
  let rendered = escapeHtml(value).replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@CODE${codeTokens.length}@@`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });

  rendered = rendered
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const normalized = escapeHtml(normalizeDocumentationLink(href));
      const external = normalized.startsWith('http') ? ' rel="noreferrer"' : '';
      return `<a href="${normalized}"${external}>${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  for (const [index, code] of codeTokens.entries()) {
    rendered = rendered.replace(`@@CODE${index}@@`, code);
  }
  return rendered;
}

function renderTable(lines) {
  const cells = (line) =>
    line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  const header = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  return `<div class="table-scroll"><table><thead><tr>${header
    .map((cell) => `<th>${renderInline(cell)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${renderInline(cell)}</td>`)
          .join('')}</tr>`
    )
    .join('')}</tbody></table></div>`;
}

function renderMarkdown(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const output = [];
  let paragraph = [];
  let listType;
  let codeLanguage;
  let codeLines = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      output.push(`</${listType}>`);
      listType = undefined;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (codeLanguage !== undefined) {
      if (line.startsWith('```')) {
        output.push(
          `<pre><code class="language-${escapeHtml(codeLanguage)}">${escapeHtml(
            codeLines.join('\n')
          )}</code></pre>`
        );
        codeLanguage = undefined;
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (line.startsWith('```')) {
      flushParagraph();
      closeList();
      codeLanguage = line.slice(3).trim();
      continue;
    }

    const nextLine = lines[index + 1] || '';
    if (line.includes('|') && /^\s*\|?\s*:?-+/.test(nextLine)) {
      flushParagraph();
      closeList();
      const tableLines = [line, nextLine];
      index += 2;
      while (index < lines.length && lines[index].includes('|')) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      output.push(renderTable(tableLines));
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      if (level > 1) {
        const text = heading[2];
        const id = text
          .toLowerCase()
          .replace(/`/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        output.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      }
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextListType = unordered ? 'ul' : 'ol';
      if (listType !== nextListType) {
        closeList();
        listType = nextListType;
        output.push(`<${listType}>`);
      }
      output.push(`<li>${renderInline((unordered || ordered)[1])}</li>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  return output.join('\n');
}

function navigation(currentSlug) {
  return [
    { slug: '', title: 'Documentation home' },
    ...pages.map(({ slug, title }) => ({ slug, title })),
  ]
    .map(({ slug, title }) => {
      const href = slug ? `/docs/${slug}/` : '/docs/';
      const current = slug === currentSlug ? ' aria-current="page"' : '';
      return `<a href="${href}"${current}>${escapeHtml(title)}</a>`;
    })
    .join('\n');
}

function documentationLayout({ slug, title, description, content }) {
  const canonical = slug ? `/docs/${slug}/` : '/docs/';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="theme-color" content="#060a0d" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(
      title
    )} — react-native-bs-diff-patch" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="https://bs-dff-patch.corerobin.com${canonical}" />
    <link rel="stylesheet" href="/assets/site.css" />
    <title>${escapeHtml(title)} — react-native-bs-diff-patch</title>
  </head>
  <body class="docs-body">
    <a class="skip-link" href="#docs-content">Skip to documentation</a>
    <div class="page-grid" aria-hidden="true"></div>
    <header class="site-header shell">
      <a class="brand" href="/" aria-label="react-native-bs-diff-patch home">
        <span class="brand-mark" aria-hidden="true">BΔ</span>
        <span>react-native-bs-diff-patch</span>
      </a>
      <nav class="nav-links" aria-label="Primary navigation">
        <a href="/#playground">Playground</a>
        <a href="/docs/">Docs</a>
        <a class="github-link" href="https://github.com/JimmyDaddy/react-native-bs-diff-patch"><span class="status-dot" aria-hidden="true"></span>GitHub</a>
      </nav>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-label="Open navigation">Menu</button>
    </header>
    <main class="docs-main shell">
      <aside class="docs-sidebar" aria-label="Documentation navigation">
        <p class="docs-sidebar-title">Documentation</p>
        <nav class="docs-nav">${navigation(slug)}</nav>
      </aside>
      <div id="docs-content" class="docs-content-wrap">
        <header class="docs-hero">
          <p class="docs-breadcrumb">Docs / ${escapeHtml(title)}</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(description)}</p>
        </header>
        <article class="docs-content">${content}</article>
      </div>
    </main>
    <footer class="site-footer shell">
      <div class="brand footer-brand"><span class="brand-mark" aria-hidden="true">BΔ</span><span>react-native-bs-diff-patch</span></div>
      <p>MIT licensed. Built for React Native runtimes.</p>
      <nav aria-label="Footer navigation"><a href="/">Home</a><a href="https://www.npmjs.com/package/react-native-bs-diff-patch">npm</a><a href="https://github.com/JimmyDaddy/react-native-bs-diff-patch">GitHub</a></nav>
    </footer>
    <script src="/assets/site.js" defer></script>
  </body>
</html>`;
}

function docsHomeContent() {
  return `<div class="docs-card-grid">${pages
    .map(
      (
        { slug, title, description },
        index
      ) => `<a class="docs-card" href="/docs/${slug}/">
  <span>${String(index + 1).padStart(2, '0')} / Guide</span>
  <div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>
</a>`
    )
    .join('')}</div>`;
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(
  path.join(siteDirectory, 'assets'),
  path.join(outputDirectory, 'assets'),
  {
    recursive: true,
  }
);

for (const filename of [
  'index.html',
  '404.html',
  'CNAME',
  'robots.txt',
  'sitemap.xml',
]) {
  await cp(
    path.join(siteDirectory, filename),
    path.join(outputDirectory, filename)
  );
}
await writeFile(path.join(outputDirectory, '.nojekyll'), '');

await cp(
  path.join(repositoryDirectory, 'web'),
  path.join(outputDirectory, 'web'),
  {
    recursive: true,
  }
);

const docsOutputDirectory = path.join(outputDirectory, 'docs');
await mkdir(docsOutputDirectory, { recursive: true });
await writeFile(
  path.join(docsOutputDirectory, 'index.html'),
  documentationLayout({
    slug: '',
    title: 'Documentation',
    description:
      'Install, integrate, operate, and troubleshoot compatible binary patches across every supported React Native runtime.',
    content: docsHomeContent(),
  })
);

for (const page of pages) {
  const markdown = await readFile(path.join(docsDirectory, page.file), 'utf8');
  const pageOutputDirectory = path.join(docsOutputDirectory, page.slug);
  await mkdir(pageOutputDirectory, { recursive: true });
  await writeFile(
    path.join(pageOutputDirectory, 'index.html'),
    documentationLayout({
      ...page,
      content: renderMarkdown(markdown),
    })
  );
}

console.log(`Built site at ${outputDirectory}`);
