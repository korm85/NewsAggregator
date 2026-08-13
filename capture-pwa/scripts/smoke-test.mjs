import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4173;
// vite.config.ts sets base: '/NewsAggregator/' for the GitHub Pages deploy.
const BASE = `http://localhost:${PORT}/NewsAggregator/`;

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
    // The browser's automatic favicon probe hits the domain root
    // (/favicon.ico), outside the /NewsAggregator/ base path the site
    // is actually served under. Expected and harmless.
    if (res.status() === 404 && !res.url().endsWith('/favicon.ico')) {
      consoleErrors.push(`404: ${res.url()}`);
    }
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

  // Let a few frames run through the tracker + live readout update.
  await page.waitForTimeout(3000);

  const readoutText = await page.$eval('#live-readout', (el) => el.textContent);
  const overlaySize = await page.$eval('#capture-overlay', (el) => ({ w: el.width, h: el.height }));
  const captureBtnEnabled = await page.$eval('#capture-btn', (el) => !el.disabled);
  console.log(
    '[smoke] after 3s of frames: readout=',
    readoutText,
    'overlaySize=',
    overlaySize,
    'captureBtnEnabled=',
    captureBtnEnabled,
  );

  // Fake camera devices don't report torch capability, so the flash
  // button should stay hidden; the switch-camera button should always
  // be visible and clicking it should not crash the app.
  const torchHidden = await page.$eval('#torch-btn', (el) => el.classList.contains('hidden'));
  console.log('[smoke] torch button hidden (expected true with fake camera):', torchHidden);

  await page.click('#switch-camera-btn');
  await page.waitForTimeout(1500);
  const stillHasVideo = await page.$eval('#capture-video', (el) => el.readyState >= 2);
  console.log('[smoke] after camera switch, video still playing:', stillHasVideo);

  await page.goto(`${BASE}debug.html`);
  await page.waitForSelector('#readout', { timeout: 10000 });
  await page.waitForTimeout(2000);
  const debugReadoutText = await page.$eval('#readout', (el) => el.textContent);
  console.log('[smoke] debug page readout:', debugReadoutText);

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
