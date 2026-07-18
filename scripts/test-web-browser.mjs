import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, '..');
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
    'Chrome executable not found; set CHROME_PATH to run the browser test'
  );
}

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
]);

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url || '/', 'http://127.0.0.1').pathname
    );
    const requestedPath = path.resolve(repositoryDirectory, `.${pathname}`);

    if (!requestedPath.startsWith(`${repositoryDirectory}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    if (!(await stat(requestedPath)).isFile()) {
      response.writeHead(404).end('Not Found');
      return;
    }

    const body = await readFile(requestedPath);
    response.writeHead(200, {
      'Content-Type':
        mimeTypes.get(path.extname(requestedPath)) ||
        'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not Found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/scripts/web-test.html`, {
    waitUntil: 'load',
  });
  await page.waitForFunction(() => document.body.dataset.status !== 'running', {
    timeout: 30_000,
  });

  const result = await page.evaluate(() => window.__bsdiffWebTestResult);
  assert.deepEqual(result, {
    inputsPreserved: true,
    invalidInputErrorCode: 'EINVAL',
    patchLength: result.patchLength,
    pathApiErrorCode: 'EUNSUPPORTED',
    restoredMatches: true,
  });
  assert.ok(result.patchLength > 24);
  console.log('Browser Web Worker diff/patch round trip passed');
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}
