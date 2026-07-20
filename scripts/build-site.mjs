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
    slug: 'native-operations-v03',
    title: 'Controllable native operations',
    description:
      'Native resource limits, cancellation, progress, and atomic output behavior.',
    file: 'native-operations-v03.md',
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
    slug: 'native-operations-v03',
    title: '可控制的原生操作',
    description: '原生资源限制、取消、进度与原子输出行为。',
    file: 'native-operations-v03.md',
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
  const markdownMatch = href.match(/^\.\/([a-z0-9-]+)\.md(#[\w-]+)?$/);
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
  homePath: '/',
  basePath: '/docs',
  alternateLanguage: 'zh-CN',
  alternateBasePath: '/docs/zh-CN',
  alternateLabel: '中文',
  homeTitle: 'Documentation home',
  homeAriaLabel: 'react-native-bs-diff-patch home',
  skipLabel: 'Skip to documentation',
  primaryNavigationLabel: 'Primary navigation',
  playgroundLabel: 'Playground',
  toolsLabel: 'Tools',
  toolsPath: '/tools/',
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
  homePath: '/zh-CN/',
  basePath: '/docs/zh-CN',
  alternateLanguage: 'en',
  alternateBasePath: '/docs',
  alternateLabel: 'English',
  homeTitle: '文档首页',
  homeAriaLabel: 'react-native-bs-diff-patch 中文首页',
  skipLabel: '跳到文档正文',
  primaryNavigationLabel: '主导航',
  playgroundLabel: '在线实验',
  toolsLabel: '工具',
  toolsPath: '/zh-CN/tools/',
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
    <meta property="og:url" content="https://bs-dff-patch.corerobin.com${canonical}" />
    <meta property="og:image" content="https://bs-dff-patch.corerobin.com/assets/social-preview.png" />
    <meta property="og:image:width" content="1280" />
    <meta property="og:image:height" content="640" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:alt" content="Binary patches everywhere React Native runs: Android, iOS, and Web" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(
      title
    )} — react-native-bs-diff-patch" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="https://bs-dff-patch.corerobin.com/assets/social-preview.png" />
    <meta name="twitter:image:alt" content="Binary patches everywhere React Native runs: Android, iOS, and Web" />
    <link rel="canonical" href="https://bs-dff-patch.corerobin.com${canonical}" />
    <link rel="alternate" hreflang="${
      ui.alternateLanguage
    }" href="https://bs-dff-patch.corerobin.com${alternate}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="stylesheet" href="/assets/site.css" />
    <title>${escapeHtml(title)} — react-native-bs-diff-patch</title>
  </head>
  <body class="docs-body">
    <a class="skip-link" href="#docs-content">${ui.skipLabel}</a>
    <div class="page-grid" aria-hidden="true"></div>
    <header class="site-header shell">
      <a class="brand" href="${ui.homePath}" aria-label="${ui.homeAriaLabel}">
        <span class="brand-mark" aria-hidden="true">BΔ</span>
        <span>react-native-bs-diff-patch</span>
      </a>
      <nav class="nav-links" aria-label="${ui.primaryNavigationLabel}">
        <a href="${ui.homePath}#playground">${ui.playgroundLabel}</a>
        <a href="${ui.toolsPath}">${ui.toolsLabel}</a>
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
      <nav aria-label="${ui.footerNavigationLabel}"><a href="${ui.homePath}">${
    ui.homeLabel
  }</a><a href="${ui.toolsPath}">${
    ui.toolsLabel
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

function localizeHomepage(source) {
  const replacements = [
    ['<html lang="en">', '<html lang="zh-CN">'],
    [
      'Create and apply compatible binary patches across React Native Android, iOS, and Web. Try the WebAssembly playground in your browser.',
      '在 React Native Android、iOS 与 Web 上创建和应用兼容二进制补丁，并直接在浏览器中体验 WebAssembly Playground。',
    ],
    [
      'One compact binary patch format for Android, iOS, and React Native Web.',
      '一套紧凑的二进制补丁格式，兼容 Android、iOS 与 React Native Web。',
    ],
    [
      '<meta property="og:title" content="react-native-bs-diff-patch" />',
      '<meta property="og:title" content="react-native-bs-diff-patch 中文首页" />',
    ],
    [
      '<meta property="og:url" content="https://bs-dff-patch.corerobin.com/" />',
      '<meta property="og:url" content="https://bs-dff-patch.corerobin.com/zh-CN/" />',
    ],
    [
      '<meta name="twitter:title" content="react-native-bs-diff-patch" />',
      '<meta name="twitter:title" content="react-native-bs-diff-patch 中文首页" />',
    ],
    [
      'Binary patches everywhere React Native runs: Android, iOS, and Web',
      '二进制补丁覆盖 React Native 可运行的每一个平台：Android、iOS 和 Web',
    ],
    [
      '<link rel="canonical" href="https://bs-dff-patch.corerobin.com/" />',
      '<link rel="canonical" href="https://bs-dff-patch.corerobin.com/zh-CN/" />',
    ],
    [
      'hreflang="zh-CN"\n      href="https://bs-dff-patch.corerobin.com/zh-CN/"',
      'hreflang="en"\n      href="https://bs-dff-patch.corerobin.com/"',
    ],
    [
      'react-native-bs-diff-patch — Binary patches everywhere RN runs',
      'react-native-bs-diff-patch — 二进制补丁，覆盖 React Native 各端',
    ],
    ['Skip to content', '跳到正文'],
    ['react-native-bs-diff-patch home', 'react-native-bs-diff-patch 中文首页'],
    ['aria-label="Primary navigation"', 'aria-label="主导航"'],
    ['>Playground</a>', '>在线实验</a>'],
    ['>Tools</a>', '>工具</a>'],
    ['>Architecture</a>', '>架构</a>'],
    ['>Evidence</a>', '>验证</a>'],
    ['<a href="./docs/">Docs</a>', '<a href="../docs/zh-CN/">文档</a>'],
    [
      '<a\n          class="language-switch"\n          href="./zh-CN/"\n          hreflang="zh-CN"\n          lang="zh-CN"\n        >\n          中文\n        </a>',
      '<a\n          class="language-switch"\n          href="../"\n          hreflang="en"\n          lang="en"\n        >\n          English\n        </a>',
    ],
    [
      '<a href="./zh-CN/" hreflang="zh-CN" lang="zh-CN">中文</a>',
      '<a href="../" hreflang="en" lang="en">English</a>',
    ],
    ['aria-label="Open navigation"', 'aria-label="打开导航"'],
    ['data-closed-label="Menu"', 'data-closed-label="菜单"'],
    ['data-open-label="Close"', 'data-open-label="关闭"'],
    ['>\n        Menu\n      </button>', '>\n        菜单\n      </button>'],
    ['Native C core · WebAssembly worker', '原生 C 核心 · WebAssembly Worker'],
    ['Binary deltas.', '二进制差量。'],
    ['Everywhere RN', '运行于 React Native'],
    ['runs.', '各端。'],
    [
      'Create and apply compact binary patches across iOS, Android, and',
      '在 iOS、Android 与',
    ],
    [
      'React Native Web—with one compatible patch format and typed API.',
      'React Native Web 上创建和应用紧凑二进制补丁；共用一种兼容格式与类型化 API。',
    ],
    ['aria-label="Supported platforms"', 'aria-label="支持的平台"'],
    ['aria-label="Copy install command"', 'aria-label="复制安装命令"'],
    [
      '>\n              Copy\n            </button>',
      '>\n              复制\n            </button>',
    ],
    [
      'aria-label="React Native Web quick start"',
      'aria-label="React Native Web 快速开始"',
    ],
    ['Live / WASM', '在线 / WASM'],
    ['Try the real implementation', '体验真实实现'],
    ['Patch playground', '补丁实验场'],
    ['Loading runtime', '正在加载运行时'],
    ['01 / Old payload', '01 / 旧数据'],
    ['02 / New payload', '02 / 新数据'],
    ['Generate patch', '生成补丁'],
    ['Cancel active', '取消当前操作'],
    ['Worker isolated', 'Worker 隔离运行'],
    ['No payload data leaves this page.', '所有数据都保留在当前页面。'],
    ['Download .patch', '下载 .patch'],
    ['<span>Max input</span>', '<span>最大输入</span>'],
    ['<span>Max output</span>', '<span>最大输出</span>'],
    ['No limit', '不设限制'],
    ['(error demo)', '（错误演示）'],
    ['>Idle</strong', '>空闲</strong'],
    ['>Patch size</span>', '>补丁大小</span>'],
    ['>Transfer saved</span>', '>节省传输</span>'],
    ['>Runtime</span>', '>运行耗时</span>'],
    ['>Error code</span>', '>错误码</span>'],
    ['Ready to generate and verify a patch', '准备好生成并验证补丁'],
    ['Same controls, explicit contracts', '同一套控制，明确的契约'],
    [
      'Progress and cancel on native. AbortSignal on Web.',
      '原生端支持进度与取消，Web 使用 AbortSignal。',
    ],
    [
      'The playground above executes the browser API. Use the matching',
      '上方 Playground 执行的是浏览器 API。Android 和 iOS 应用中请使用对应的',
    ],
    [
      'path-based job facade in Android and iOS applications.',
      '基于路径的 job facade。',
    ],
    ['>Native job</strong>', '>原生任务</strong>'],
    ['>Worker + signal</strong>', '>Worker + 信号</strong>'],
    ['aria-label="Operation error codes"', 'aria-label="操作错误码"'],
    ['Native cancelled', '原生端已取消'],
    ['Native input limit', '原生端输入限制'],
    ['Native output limit', '原生端输出限制'],
    ['Web cancelled', 'Web 已取消'],
    ['Web size limit', 'Web 大小限制'],
    ['Wrong platform API', '平台 API 不匹配'],
    ['Under the hood', '底层机制'],
    ['One format.<br />Three runtimes.', '一种格式。<br />三种运行时。'],
    ['Typed API', '类型化 API'],
    [
      'Paths on native. Binary inputs on Web.',
      '原生端使用路径，Web 使用二进制输入。',
    ],
    ['Worker boundary', 'Worker 边界'],
    [
      'Serial native queues or an isolated module Worker.',
      '串行原生队列，或隔离的模块 Worker。',
    ],
    ['Shared C core', '共享 C 核心'],
    [
      'The same bsdiff and bzip2 sources everywhere.',
      '所有平台使用相同的 bsdiff 与 bzip2 源码。',
    ],
    ['Compact delta', '紧凑差量'],
    [
      'A compatible `ENDSLEY/BSDIFF43` patch.',
      '兼容的 `ENDSLEY/BSDIFF43` 补丁。',
    ],
    ['Designed for integration', '为集成而设计'],
    [
      'Native performance.<br />Explicit platform contracts.',
      '原生性能。<br />清晰的平台契约。',
    ],
    [
      "Expensive work stays off React Native's module queue and the browser",
      '高成本工作不会阻塞 React Native 模块队列或浏览器',
    ],
    [
      'main thread. Unsupported API families reject clearly instead of',
      '主线程。遇到不支持的 API，库会明确拒绝，而不是',
    ],
    ['guessing at filesystem behavior.', '猜测文件系统行为。'],
    ['Read the architecture →', '阅读架构说明 →'],
    ['New Architecture ready', '已适配新架构'],
    [
      'Version-aware Android packages and generated iOS TurboModule',
      '按版本适配的 Android package 与生成的 iOS TurboModule',
    ],
    ['registration.', '注册。'],
    ['Web Worker by default', '默认使用 Web Worker'],
    [
      'WASM work runs outside the page thread; shared calls reuse the',
      'WASM 任务运行在页面线程之外；多次调用复用已初始化的',
    ],
    [
      'initialized runtime and cancellation stays operation-local.',
      '运行时，取消只影响当前操作。',
    ],
    ['Cross-platform patches', '跨平台补丁'],
    [
      'Create a patch on one supported runtime and apply it on another.',
      '可在一个受支持运行时生成补丁，并在另一个运行时应用。',
    ],
    ['Release-grade checks', '发布级检查'],
    [
      'Native matrices, device assertions, browser round trips, Metro and',
      '原生兼容矩阵、设备断言、浏览器往返测试、Metro 与',
    ],
    ['package gates.', '安装包门禁。'],
    ['Measured and compiled', '真实编译与测量'],
    ['Evidence behind the compatibility claim.', '兼容性承诺的验证依据。'],
    [
      'The release gates compile real React Native artifacts, exercise one',
      '发布门禁会编译真实的 React Native 产物，使用同一份',
    ],
    [
      'golden patch across native and Web, fuzz malformed patches, and',
      'golden patch 覆盖原生端与 Web，模糊测试畸形补丁，并在',
    ],
    [
      'install the packed npm tarball in clean consumers.',
      '干净消费者工程中安装打包后的 npm tarball。',
    ],
    [
      'aria-label="React Native test matrix"',
      'aria-label="React Native 测试矩阵"',
    ],
    ['Legacy + New', '旧架构 + 新架构'],
    ['New Architecture', '新架构'],
    ['Current matrix anchor', '当前矩阵基准'],
    ['npm tarball', 'npm 安装包'],
    ['125 KiB packed', '125 KiB 压缩包'],
    ['459 KiB unpacked · 58 files', '459 KiB 解压后 · 58 个文件'],
    ['WebAssembly reference', 'WebAssembly 参考数据'],
    ['Repeatable, not theoretical.', '可复现，而非纸面数据。'],
    [
      'Apple M3 Pro · Node 26.5.0 · one changed byte per 4 KiB. Every run',
      'Apple M3 Pro · Node 26.5.0 · 每 4 KiB 仅变更一个字节。每次运行都会',
    ],
    [
      'verifies the restored bytes. Treat these as a development',
      '验证还原后的字节。请将这些数据视为开发阶段的',
    ],
    [
      'baseline, not a browser performance guarantee.',
      '基线，而非浏览器性能承诺。',
    ],
    ['Benchmark methodology →', '性能数据方法 →'],
    ['>Input</th>', '>输入</th>'],
    ['Documentation', '文档'],
    ['From first patch to production boundaries.', '从第一个补丁到生产边界。'],
    [
      'Follow platform-specific setup, inspect every API and error code, and',
      '了解各平台安装方式，查阅每个 API 与错误码，并在发布前',
    ],
    [
      'understand memory, bundler, and compatibility constraints before you',
      '理解内存、打包器与兼容性约束，',
    ],
    ['ship.', '完成上线准备。'],
    ['Open documentation →', '打开文档 →'],
    ['Troubleshooting', '排障指南'],
    [
      'MIT licensed. Built for React Native runtimes.',
      'MIT 许可，为 React Native 多运行时构建。',
    ],
    ['aria-label="Footer navigation"', 'aria-label="页脚导航"'],
    ['href="./docs/architecture/"', 'href="../docs/zh-CN/architecture/"'],
    ['href="./docs/troubleshooting/"', 'href="../docs/zh-CN/troubleshooting/"'],
    ['href="./docs/"', 'href="../docs/zh-CN/"'],
    ['href="./zh-CN/"', 'href="../"'],
    ['href="./assets/site.css"', 'href="../assets/site.css"'],
    ['src="./assets/playground.js"', 'src="../assets/playground.js"'],
    ['src="./assets/site.js"', 'src="../assets/site.js"'],
  ];

  return replacements.reduce(
    (localized, [from, to]) => localized.replaceAll(from, to),
    source
  );
}

const englishToolsUi = {
  ALTERNATE_LABEL: '中文',
  ALTERNATE_LANGUAGE: 'zh-CN',
  ALTERNATE_PATH: '/zh-CN/tools/',
  CANONICAL_PATH: '/tools/',
  CLOSE_LABEL: 'Close',
  COPY_LABEL: 'Copy code',
  DOCS_LABEL: 'Docs',
  DOCS_PATH: '/docs/',
  FOOTER_NAVIGATION_LABEL: 'Footer navigation',
  FOOTER_TEXT: 'MIT licensed. Built for React Native runtimes.',
  HOME_ARIA_LABEL: 'react-native-bs-diff-patch home',
  HOME_LABEL: 'Home',
  HOME_PATH: '/',
  LANG: 'en',
  MENU_LABEL: 'Menu',
  META_DESCRIPTION:
    'Create, apply, inspect, and verify ENDSLEY/BSDIFF43 binary patches locally in your browser. No file upload required.',
  NO_FILE_LABEL: 'No file selected',
  NO_LIMIT_LABEL: 'No limit',
  OG_TITLE: 'Binary Patch Toolkit — react-native-bs-diff-patch',
  PAGE_TITLE: 'Binary Patch Toolkit — react-native-bs-diff-patch',
  PLAYGROUND_LABEL: 'Playground',
  PLAYGROUND_PATH: '/#playground',
  PRIMARY_NAVIGATION_LABEL: 'Primary navigation',
  READY_LABEL: 'Ready',
  RECIPES_PATH: '/docs/recipes/',
  REPORT_EMPTY: 'A report will appear here after the operation.',
  RUNTIME_LOADING: 'Loading Web API',
  SKIP_LABEL: 'Skip to tools',
  TOOLS_LABEL: 'Tools',
  UNKNOWN_LABEL: 'Unknown',
};

const chineseToolsUi = {
  ALTERNATE_LABEL: 'English',
  ALTERNATE_LANGUAGE: 'en',
  ALTERNATE_PATH: '/tools/',
  CANONICAL_PATH: '/zh-CN/tools/',
  CLOSE_LABEL: '关闭',
  COPY_LABEL: '复制代码',
  DOCS_LABEL: '中文文档',
  DOCS_PATH: '/docs/zh-CN/',
  FOOTER_NAVIGATION_LABEL: '页脚导航',
  FOOTER_TEXT: 'MIT 许可，为 React Native 多运行时构建。',
  HOME_ARIA_LABEL: 'react-native-bs-diff-patch 中文首页',
  HOME_LABEL: '首页',
  HOME_PATH: '/zh-CN/',
  LANG: 'zh-CN',
  MENU_LABEL: '菜单',
  META_DESCRIPTION:
    '直接在浏览器本地创建、应用、检查和验证 ENDSLEY/BSDIFF43 二进制补丁，无需上传文件。',
  NO_FILE_LABEL: '尚未选择文件',
  NO_LIMIT_LABEL: '不设限制',
  OG_TITLE: '二进制补丁工具箱 — react-native-bs-diff-patch',
  PAGE_TITLE: '二进制补丁工具箱 — react-native-bs-diff-patch',
  PLAYGROUND_LABEL: '在线实验',
  PLAYGROUND_PATH: '/zh-CN/#playground',
  PRIMARY_NAVIGATION_LABEL: '主导航',
  READY_LABEL: '就绪',
  RECIPES_PATH: '/docs/zh-CN/recipes/',
  REPORT_EMPTY: '操作完成后将在这里生成报告。',
  RUNTIME_LOADING: '正在加载 Web API',
  SKIP_LABEL: '跳到工具正文',
  TOOLS_LABEL: '工具',
  UNKNOWN_LABEL: '未知',
};

function renderToolsPage(template, ui) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (token, key) => {
    if (!(key in ui)) {
      throw new Error(`Missing tools page value for ${token}`);
    }
    return ui[key];
  });
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
  'favicon.svg',
  'favicon-32.png',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'site.webmanifest',
  'robots.txt',
  'sitemap.xml',
]) {
  await cp(
    path.join(siteDirectory, filename),
    path.join(outputDirectory, filename)
  );
}
await writeFile(path.join(outputDirectory, '.nojekyll'), '');

const homepage = await readFile(path.join(siteDirectory, 'index.html'), 'utf8');
const chineseHomepageDirectory = path.join(outputDirectory, 'zh-CN');
await mkdir(chineseHomepageDirectory, { recursive: true });
await writeFile(
  path.join(chineseHomepageDirectory, 'index.html'),
  localizeHomepage(homepage)
);

const toolsTemplate = await readFile(
  path.join(siteDirectory, 'tools', 'index.html'),
  'utf8'
);
const toolsOutputDirectory = path.join(outputDirectory, 'tools');
await mkdir(toolsOutputDirectory, { recursive: true });
await writeFile(
  path.join(toolsOutputDirectory, 'index.html'),
  renderToolsPage(toolsTemplate, englishToolsUi)
);
const chineseToolsOutputDirectory = path.join(
  chineseHomepageDirectory,
  'tools'
);
await mkdir(chineseToolsOutputDirectory, { recursive: true });
await writeFile(
  path.join(chineseToolsOutputDirectory, 'index.html'),
  renderToolsPage(toolsTemplate, chineseToolsUi)
);

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
