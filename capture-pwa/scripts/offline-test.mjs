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
        /* not up yet */
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

let exitCode = 0;
try {
  await waitForServer(BASE, 15000);

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const context = await browser.newContext({ permissions: ['camera'] });
  const page = await context.newPage();

  await page.goto(BASE);
  // Let the service worker install and finish precaching before going offline.
  await page.waitForFunction(() => navigator.serviceWorker?.ready, null, { timeout: 15000 });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(2000);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });

  await page.reload();
  await page.waitForSelector('#continue-btn', { timeout: 10000 });
  const heading = await page.$eval('h1', (el) => el.textContent);
  console.log('[offline] app shell loaded offline. Heading:', heading);

  await page.click('#continue-btn');
  await page.waitForSelector('#capture-video', { timeout: 30000 });
  console.log('[offline] camera + MediaPipe model loaded fully offline');

  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await browser.close();
  console.log('[offline] PASS');
} catch (err) {
  console.error('[offline] FAILED:', err);
  exitCode = 1;
} finally {
  server.kill();
}
process.exit(exitCode);
