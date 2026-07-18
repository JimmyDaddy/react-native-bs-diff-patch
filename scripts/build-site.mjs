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
    slug: 'recipes',
    title: 'Production recipes',
    description:
      'Integrity checks, temporary files, downloads, resource limits, and cross-runtime workflows.',
    file: 'recipes.md',
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

const chinesePages = [
  {
    slug: 'getting-started',
    title: '快速开始',
    description: '安装依赖，并完成第一次原生端或 Web 补丁往返。',
    file: 'getting-started.md',
  },
  {
    slug: 'api-reference',
    title: 'API 参考',
    description: '函数签名、可接受输入、返回值、错误码和并发行为。',
    file: 'api-reference.md',
  },
  {
    slug: 'recipes',
    title: '生产实践',
    description: '补丁完整性、临时文件、下载、资源限制和跨运行时流程。',
    file: 'recipes.md',
  },
  {
    slug: 'platform-support',
    title: '平台支持',
    description: 'Android、iOS、新架构、React Native Web 与打包器要求。',
    file: 'platform-support.md',
  },
  {
    slug: 'architecture',
    title: '架构',
    description: '执行边界、共用 C 核心、WebAssembly 打包与补丁兼容性。',
    file: 'architecture.md',
  },
  {
    slug: 'troubleshooting',
    title: '常见问题与排障',
    description: '处理原生注册、文件系统、Worker、WebAssembly 与格式错误。',
    file: 'troubleshooting.md',
  },
  {
    slug: 'development',
    title: '开发与验证',
    description: '仓库配置、原生与 Web 门禁、站点测试、WASM 构建和发布检查。',
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
          .normalize('NFKC')
          .toLowerCase()
          .replace(/`/g, '')
          .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
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

const englishUi = {
  language: 'en',
  basePath: '/docs',
  alternateLanguage: 'zh-CN',
  alternateBasePath: '/docs/zh-CN',
  alternateLabel: '中文',
  homeTitle: 'Documentation home',
  skipLabel: 'Skip to documentation',
  primaryNavigationLabel: 'Primary navigation',
  playgroundLabel: 'Playground',
  docsLabel: 'Docs',
  menuLabel: 'Menu',
  closeMenuLabel: 'Close',
  sidebarLabel: 'Documentation navigation',
  sidebarTitle: 'Documentation',
  breadcrumbLabel: 'Docs',
  guideLabel: 'Guide',
  footerText: 'MIT licensed. Built for React Native runtimes.',
  footerNavigationLabel: 'Footer navigation',
  homeLabel: 'Home',
};

const chineseUi = {
  language: 'zh-CN',
  basePath: '/docs/zh-CN',
  alternateLanguage: 'en',
  alternateBasePath: '/docs',
  alternateLabel: 'English',
  homeTitle: '文档首页',
  skipLabel: '跳到文档正文',
  primaryNavigationLabel: '主导航',
  playgroundLabel: 'Playground',
  docsLabel: '中文文档',
  menuLabel: '菜单',
  closeMenuLabel: '关闭',
  sidebarLabel: '文档导航',
  sidebarTitle: '中文文档',
  breadcrumbLabel: '文档',
  guideLabel: '指南',
  footerText: 'MIT 许可，为 React Native 多运行时构建。',
  footerNavigationLabel: '页脚导航',
  homeLabel: '首页',
};

function navigation(items, currentSlug, ui) {
  return [
    { slug: '', title: ui.homeTitle },
    ...items.map(({ slug, title }) => ({ slug, title })),
  ]
    .map(({ slug, title }) => {
      const href = slug ? `${ui.basePath}/${slug}/` : `${ui.basePath}/`;
      const current = slug === currentSlug ? ' aria-current="page"' : '';
      return `<a href="${href}"${current}>${escapeHtml(title)}</a>`;
    })
    .join('\n');
}

function documentationLayout({ slug, title, description, content, items, ui }) {
  const canonical = slug ? `${ui.basePath}/${slug}/` : `${ui.basePath}/`;
  const alternate = slug
    ? `${ui.alternateBasePath}/${slug}/`
    : `${ui.alternateBasePath}/`;
  return `<!doctype html>
<html lang="${ui.language}">
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
    <link rel="alternate" hreflang="${
      ui.alternateLanguage
    }" href="https://bs-dff-patch.corerobin.com${alternate}" />
    <link rel="stylesheet" href="/assets/site.css" />
    <title>${escapeHtml(title)} — react-native-bs-diff-patch</title>
  </head>
  <body class="docs-body">
    <a class="skip-link" href="#docs-content">${ui.skipLabel}</a>
    <div class="page-grid" aria-hidden="true"></div>
    <header class="site-header shell">
      <a class="brand" href="/" aria-label="react-native-bs-diff-patch home">
        <span class="brand-mark" aria-hidden="true">BΔ</span>
        <span>react-native-bs-diff-patch</span>
      </a>
      <nav class="nav-links" aria-label="${ui.primaryNavigationLabel}">
        <a href="/#playground">${ui.playgroundLabel}</a>
        <a href="${ui.basePath}/">${ui.docsLabel}</a>
        <a href="${alternate}" hreflang="${ui.alternateLanguage}">${
    ui.alternateLabel
  }</a>
        <a class="github-link" href="https://github.com/JimmyDaddy/react-native-bs-diff-patch"><span class="status-dot" aria-hidden="true"></span>GitHub</a>
      </nav>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-label="${
        ui.primaryNavigationLabel
      }" data-closed-label="${ui.menuLabel}" data-open-label="${
    ui.closeMenuLabel
  }">${ui.menuLabel}</button>
    </header>
    <main class="docs-main shell">
      <aside class="docs-sidebar" aria-label="${ui.sidebarLabel}">
        <p class="docs-sidebar-title">${ui.sidebarTitle}</p>
        <nav class="docs-nav">${navigation(items, slug, ui)}</nav>
      </aside>
      <div id="docs-content" class="docs-content-wrap">
        <header class="docs-hero">
          <p class="docs-breadcrumb">${ui.breadcrumbLabel} / ${escapeHtml(
    title
  )}</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(description)}</p>
        </header>
        <article class="docs-content">${content}</article>
      </div>
    </main>
    <footer class="site-footer shell">
      <div class="brand footer-brand"><span class="brand-mark" aria-hidden="true">BΔ</span><span>react-native-bs-diff-patch</span></div>
      <p>${ui.footerText}</p>
      <nav aria-label="${ui.footerNavigationLabel}"><a href="/">${
    ui.homeLabel
  }</a><a href="https://www.npmjs.com/package/react-native-bs-diff-patch">npm</a><a href="https://github.com/JimmyDaddy/react-native-bs-diff-patch">GitHub</a></nav>
    </footer>
    <script src="/assets/site.js" defer></script>
  </body>
</html>`;
}

function docsHomeContent(items, ui) {
  return `<div class="docs-card-grid">${items
    .map(
      ({ slug, title, description }, index) => `<a class="docs-card" href="${
        ui.basePath
      }/${slug}/">
  <span>${String(index + 1).padStart(2, '0')} / ${ui.guideLabel}</span>
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
    content: docsHomeContent(pages, englishUi),
    items: pages,
    ui: englishUi,
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
      items: pages,
      ui: englishUi,
    })
  );
}

const chineseDocsDirectory = path.join(docsDirectory, 'zh-CN');
const chineseOutputDirectory = path.join(docsOutputDirectory, 'zh-CN');
await mkdir(chineseOutputDirectory, { recursive: true });
await writeFile(
  path.join(chineseOutputDirectory, 'index.html'),
  documentationLayout({
    slug: '',
    title: '中文文档',
    description:
      '安装、集成、运行并排查 Android、iOS 与 React Native Web 上的兼容二进制补丁。',
    content: docsHomeContent(chinesePages, chineseUi),
    items: chinesePages,
    ui: chineseUi,
  })
);

for (const page of chinesePages) {
  const markdown = await readFile(
    path.join(chineseDocsDirectory, page.file),
    'utf8'
  );
  const pageOutputDirectory = path.join(chineseOutputDirectory, page.slug);
  await mkdir(pageOutputDirectory, { recursive: true });
  await writeFile(
    path.join(pageOutputDirectory, 'index.html'),
    documentationLayout({
      ...page,
      content: renderMarkdown(markdown),
      items: chinesePages,
      ui: chineseUi,
    })
  );
}

console.log(`Built site at ${outputDirectory}`);
