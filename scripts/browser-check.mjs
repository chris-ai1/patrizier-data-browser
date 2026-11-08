// Authors: Christian Reitwiessner
// Optional local browser QA. Uses a temporary loopback-only static test server.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
if (!process.env.PATRIZIER_ZIP) throw new Error('Set PATRIZIER_ZIP to your local reference archive.');
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  args: ['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage', ...(process.env.BROWSER_ARGS ? JSON.parse(process.env.BROWSER_ARGS) : [])] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [], requests = [];
const root = path.resolve('dist');
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  requests.push({ path: url.pathname, method: request.method });
  const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(file);
    response.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[path.extname(name)] || 'application/octet-stream' });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (!['blob:', 'data:'].includes(url.protocol) && url.origin !== origin) {
    errors.push('Unexpected external request: ' + url.origin); await route.abort(); return;
  }
  await route.continue();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
async function choose(query, panel) {
  await page.locator('#search').fill(query);
  await page.locator('.file-row').click();
  await page.locator(`#${panel}:visible`).waitFor();
}
try {
  await page.goto(origin);
  await page.locator('#archive:enabled').waitFor();
  await page.locator('#archive').setInputFiles(process.env.PATRIZIER_ZIP);
  await page.locator('#image-panel:visible').waitFor();
  await page.waitForFunction(() => document.querySelector('#image-info').textContent === '320 × 200 px');
  assert.equal(await page.locator('#count').textContent(), '105 / 105');
  await choose('Kontor', 'image-panel');
  await page.locator('#save-png:enabled').waitFor();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#save-png').click();
  assert.equal((await downloadPromise).suggestedFilename(), 'Kontor.fdl.png');
  await choose('Schlacht.fdl', 'image-panel');
  await page.locator('#save-png:enabled').waitFor();
  assert.equal(await page.locator('#palette').inputValue(), '4294967294');
  await page.locator('#chunk').selectOption({ label: '4' });
  await page.locator('#save-png:enabled').waitFor();
  assert.equal(await page.locator('#palette').inputValue(), '4294967294');
  await choose('mdat.2', 'music-panel');
  await page.locator('#play').click();
  await page.waitForFunction(() => document.querySelector('#audio-status').textContent.startsWith('Playing'));
  assert.equal(await page.locator('#subsong option').count(), 9);
  await page.locator('#pause').click();
  assert.equal(await page.locator('#pause').textContent(), 'Resume');
  await page.locator('#pause').click();
  await page.locator('#subsong').selectOption('2');
  await page.locator('#stop').click();
  await page.locator('#play').click();
  await page.waitForFunction(() => document.querySelector('#audio-status').textContent.startsWith('Playing'));
  assert.equal(await page.locator('#subsong').inputValue(), '0');
  await choose('smpl.1', 'sample-panel');
  await page.locator('#sample-wav').click();
  await page.waitForFunction(() => !document.querySelector('#sample-player').paused);
  assert.equal(await page.locator('#sample-player').evaluate(a => a.error), null);
  await choose('PatrizierGame', 'data-panel');
  await page.locator('#tab-hex').click();
  await page.waitForFunction(() => document.querySelector('#hex-page').textContent === '1 / 63');
  await page.locator('#tab-text').click();
  assert.match(await page.locator('#strings').textContent(), /Johann/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile horizontal overflow');
  assert.ok(requests.every(r => r.method === 'GET'), 'file data must never be uploaded');
  assert.deepEqual(errors, []);
  console.log('Browser QA passed: archive import, image/PNG, cached palettes, music/subsongs, WAV, hex/strings, mobile width and no uploads.');
} catch (error) { console.error('Browser failure context:', { notice: await page.locator('#notice').textContent(), audio: await page.locator('#audio-status').textContent(), errors, requests }); throw error; } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
