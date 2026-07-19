import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(scriptDirectory, '../site-dist');
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = chromeCandidates.find((candidate) =>
  existsSync(candidate)
);

if (!executablePath) {
  throw new Error(
    'Chrome executable not found; set CHROME_PATH to run the site test'
  );
}

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url || '/', 'http://127.0.0.1').pathname
    );
    const requestedPath = path.resolve(
      outputDirectory,
      `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`
    );
    if (!requestedPath.startsWith(`${outputDirectory}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if (!(await stat(requestedPath)).isFile()) {
      response.writeHead(404).end('Not Found');
      return;
    }
    response.writeHead(200, {
      'Content-Type':
        mimeTypes.get(path.extname(requestedPath)) ||
        'application/octet-stream',
    });
    response.end(await readFile(requestedPath));
  } catch {
    response.writeHead(404).end('Not Found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#runtime-state[data-state="ready"]');
  await page.click('#generate-patch');
  await page.waitForSelector('#playground-status[data-state="success"]', {
    timeout: 30_000,
  });

  const result = await page.evaluate(() => ({
    heading: document.querySelector('h1')?.textContent,
    patchSize: document.querySelector('#patch-size')?.textContent,
    status: document.querySelector('#playground-status')?.textContent?.trim(),
    evidenceRows: document.querySelectorAll('.benchmark-table tbody tr').length,
  }));
  assert.match(result.heading || '', /Binary deltas/);
  assert.notEqual(result.patchSize, '—');
  assert.match(result.status || '', /verified byte-for-byte/);
  assert.equal(result.evidenceRows, 3);

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'networkidle0' });
  const mobile = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    mobile.scrollWidth <= mobile.clientWidth + 1,
    `mobile layout overflows by ${mobile.scrollWidth - mobile.clientWidth}px`
  );

  await page.goto(`${baseUrl}/docs/api-reference/`, {
    waitUntil: 'networkidle0',
  });
  assert.equal(
    await page.$eval('h1', (element) => element.textContent),
    'API reference'
  );

  await page.goto(`${baseUrl}/docs/zh-CN/getting-started/`, {
    waitUntil: 'networkidle0',
  });
  assert.equal(
    await page.$eval('h1', (element) => element.textContent),
    '快速开始'
  );
  assert.equal(await page.$eval('html', (element) => element.lang), 'zh-CN');
  assert.equal(
    await page.$eval('a[hreflang="en"]', (element) => element.textContent),
    'English'
  );
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  console.log('Site Playground, bilingual docs, and mobile viewport passed');
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}
