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
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json'],
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

  await page.select('#max-input-bytes', '64');
  await page.click('#generate-patch');
  await page.waitForSelector('#playground-status[data-state="error"]');
  assert.equal(
    await page.$eval('#error-code', (element) => element.textContent),
    'ERESOURCE'
  );

  await page.select('#max-input-bytes', '');
  await page.$eval('#old-payload', (element) => {
    element.value = 'a'.repeat(4 * 1024 * 1024);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.$eval('#new-payload', (element) => {
    element.value = `${'a'.repeat(4 * 1024 * 1024 - 1)}b`;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#generate-patch');
  await page.waitForSelector('#cancel-operation:not([disabled])');
  await page.click('#cancel-operation');
  await page.waitForFunction(
    () => document.querySelector('#error-code')?.textContent === 'EABORTED',
    { timeout: 30_000 }
  );

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

  await page.goto(`${baseUrl}/zh-CN/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#runtime-state[data-state="ready"]');
  assert.equal(await page.$eval('html', (element) => element.lang), 'zh-CN');
  assert.match(
    await page.$eval('h1', (element) => element.textContent || ''),
    /二进制差量/
  );
  assert.equal(
    await page.$eval('a[hreflang="en"]', (element) =>
      element.textContent.trim()
    ),
    'English'
  );

  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/tools/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#tool-runtime-state[data-state="ready"]');

  const fixtures = await page.evaluate(async () => {
    const encoder = new TextEncoder();
    const oldBytes = encoder.encode('release=1\nfeatures=native\n');
    const newBytes = encoder.encode('release=2\nfeatures=native,web\n');
    const { diffBytes } = await import('/web/index.mjs');
    const patch = await diffBytes(oldBytes, newBytes);
    return {
      oldBytes: [...oldBytes],
      newBytes: [...newBytes],
      patch: [...patch],
    };
  });

  const selectFile = async (selector, bytes, filename) => {
    await page.evaluate(
      ({ inputSelector, fileBytes, fileName }) => {
        const input = document.querySelector(inputSelector);
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([new Uint8Array(fileBytes)], fileName, {
            type: 'application/octet-stream',
          })
        );
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { inputSelector: selector, fileBytes: bytes, fileName: filename }
    );
  };

  await selectFile('#create-old-file', fixtures.oldBytes, 'release-v1.bin');
  await selectFile('#create-new-file', fixtures.newBytes, 'release-v2.bin');
  await page.click('#create-run');
  await page.waitForSelector('#create-status[data-state="success"]', {
    timeout: 30_000,
  });
  assert.match(
    await page.$eval('#create-report', (element) => element.textContent || ''),
    /Byte-for-byte match: PASS/
  );
  assert.notEqual(
    await page.$eval('#create-patch-size', (element) => element.textContent),
    '—'
  );

  await page.click('#apply-tab');
  await selectFile('#apply-old-file', fixtures.oldBytes, 'release-v1.bin');
  await selectFile('#apply-patch-file', fixtures.patch, 'release-v2.patch');
  await selectFile('#apply-expected-file', fixtures.newBytes, 'release-v2.bin');
  await page.select('#apply-origin', 'Android');
  await page.click('#apply-run');
  await page.waitForSelector('#apply-status[data-state="success"]', {
    timeout: 30_000,
  });
  assert.match(
    await page.$eval('#apply-report', (element) => element.textContent || ''),
    /Generated on: Android[\s\S]*Byte-for-byte match: PASS/
  );

  await page.click('#inspect-tab');
  await selectFile('#inspect-patch-file', fixtures.patch, 'release-v2.patch');
  await page.click('#inspect-run');
  await page.waitForSelector('#inspect-status[data-state="success"]');
  assert.equal(
    await page.$eval('#inspect-format', (element) => element.textContent),
    'ENDSLEY/BSDIFF43'
  );

  await selectFile('#manifest-old-file', fixtures.oldBytes, 'release-v1.bin');
  await selectFile('#manifest-new-file', fixtures.newBytes, 'release-v2.bin');
  await selectFile('#manifest-patch-file', fixtures.patch, 'release-v2.patch');
  await page.click('#manifest-run');
  await page.waitForSelector('#manifest-status[data-state="success"]');
  const generatedManifest = JSON.parse(
    await page.$eval('#manifest-output', (element) => element.textContent || '')
  );
  assert.equal(generatedManifest.manifestVersion, 1);
  assert.equal(generatedManifest.patchFormat, 'ENDSLEY/BSDIFF43');
  assert.equal(generatedManifest.target.bytes, fixtures.newBytes.length);
  assert.equal(generatedManifest.target.sha256.length, 64);
  assert.equal(generatedManifest.patch.sha256.length, 64);

  await page.$eval('#savings-target-mib', (element) => {
    element.value = '10';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.$eval('#savings-patch-mib', (element) => {
    element.value = '2';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.$eval('#savings-downloads', (element) => {
    element.value = '5';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(
    await page.$eval('#savings-rate', (element) => element.textContent),
    '80.0%'
  );
  assert.equal(
    await page.$eval('#savings-equivalent', (element) => element.textContent),
    '4'
  );

  await page.select('#diagnostic-code', 'ERESOURCE');
  assert.match(
    await page.$eval(
      '#diagnostic-action',
      (element) => element.textContent || ''
    ),
    /maxInputBytes/
  );
  assert.match(
    await page.$eval(
      '#diagnostic-example',
      (element) => element.textContent || ''
    ),
    /maxOutputBytes/
  );

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'networkidle0' });
  const toolsMobile = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    toolsMobile.scrollWidth <= toolsMobile.clientWidth + 1,
    `tools mobile layout overflows by ${
      toolsMobile.scrollWidth - toolsMobile.clientWidth
    }px`
  );

  await page.goto(`${baseUrl}/zh-CN/tools/`, {
    waitUntil: 'networkidle0',
  });
  assert.equal(await page.$eval('html', (element) => element.lang), 'zh-CN');
  assert.match(
    await page.$eval('h1', (element) => element.textContent || ''),
    /二进制补丁工具/
  );
  assert.equal(
    await page.$eval('a[hreflang="en"]', (element) =>
      element.textContent.trim()
    ),
    'English'
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
  console.log(
    'Site Playground, Binary Patch Toolkit, localization, and mobile viewport passed'
  );
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}
