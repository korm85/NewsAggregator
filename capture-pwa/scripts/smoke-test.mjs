import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() - start > timeoutMs) return reject(new Error('server did not start'));
      setTimeout(tick, 200);
    };
    tick();
  });
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'pipe',
});
server.stdout.on('data', (d) => process.stdout.write(`[preview] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));

let exitCode = 0;
try {
  await waitForServer(BASE, 15000);

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });
  const context = await browser.newContext({ permissions: ['camera'] });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    // MediaPipe's TFLite runtime logs informational lines (e.g. XNNPACK
    // delegate creation) through console.error; they are not failures.
    if (msg.type() === 'error' && !msg.text().startsWith('INFO:')) {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() === 404) consoleErrors.push(`404: ${res.url()}`);
  });
  page.on('requestfailed', (req) => {
    consoleErrors.push(`requestfailed: ${req.url()} (${req.failure()?.errorText})`);
  });
  context.on('page', (p) => {
    p.on('response', (res) => {
      if (res.status() === 404) consoleErrors.push(`404 (worker/other page): ${res.url()}`);
    });
  });

  await page.goto(BASE);
  await page.waitForSelector('#continue-btn', { timeout: 10000 });
  console.log('[smoke] permission screen rendered');

  await page.click('#continue-btn');

  // Loading tracker involves fetching + initializing the ~3.7MB model,
  // give it a generous window.
  await page.waitForSelector('#capture-video', { timeout: 30000 });
  console.log('[smoke] viewfinder rendered, camera stream attached');

  // Let a few frames run through tracker + gate evaluator + overlay draw.
  await page.waitForTimeout(3000);

  const bannerHidden = await page.$eval('#prompt-banner', (el) => el.classList.contains('hidden'));
  const overlaySize = await page.$eval('#capture-overlay', (el) => ({ w: el.width, h: el.height }));
  console.log('[smoke] after 3s of frames: bannerHidden=', bannerHidden, 'overlaySize=', overlaySize);

  await page.goto(`${BASE}/debug.html`);
  await page.waitForSelector('#readout', { timeout: 10000 });
  await page.waitForTimeout(2000);
  const readoutText = await page.$eval('#readout', (el) => el.textContent);
  console.log('[smoke] debug page readout:', readoutText);

  await browser.close();

  if (consoleErrors.length > 0) {
    console.error('[smoke] console errors detected:');
    for (const e of consoleErrors) console.error(' -', e);
    exitCode = 1;
  } else {
    console.log('[smoke] no console errors. PASS');
  }
} catch (err) {
  console.error('[smoke] FAILED:', err);
  exitCode = 1;
} finally {
  server.kill();
}

process.exit(exitCode);
