import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';
import { beaconPackage } from './fixtures.mjs';
import { testDestinations } from './destinations.mjs';

const pages = process.argv.includes('--pages');
const pagesBase = '/music-universe/';
const loopback = { host: '127.0.0.1', port: 0 };
const testURL = process.env.MUSIC_UNIVERSE_TEST_URL;

async function startLocalServer() {
  if (pages) return preview({ base: pagesBase, preview: loopback });
  const server = await createServer({ server: loopback });
  await server.listen();
  return server;
}

const server = testURL ? null : await startLocalServer();
const url = testURL ?? server.resolvedUrls.local[0];
const browser = await chromium.launch({
  channel: process.env.MUSIC_UNIVERSE_BROWSER || undefined,
}).catch(async error => {
  await server?.close();
  throw error;
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors = [];
  const responses = new Map();
  page.on('pageerror', error => errors.push(error.message));
  if (pages) {
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.location().url + ' ' + message.text());
    });
    page.on('requestfailed', request => errors.push(request.method() + ' ' + request.url()));
    page.on('response', response => {
      responses.set(response.url(), response.status());
      if (response.status() >= 400) errors.push(response.status() + ' ' + response.url());
    });
  }

  await page.addInitScript(() => {
    const probe = { rms: [], world: [], frames: [], pitches: [], schedulers: new Set() };
    window.probe = probe;
    const timer = window.setInterval;
    const cancel = window.clearInterval;
    window.setInterval = function (callback, delay, ...args) {
      const id = timer(callback, delay, ...args);
      if (delay === 21) probe.schedulers.add(id);
      return id;
    };
    window.clearInterval = function (id) {
      probe.schedulers.delete(id);
      cancel(id);
    };

    const createAnalyser = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function () {
      const analyser = createAnalyser.call(this);
      const wave = new Float32Array(2048);
      let world;
      timer(() => {
        const time = this.currentTime;
        analyser.getFloatTimeDomainData(wave);
        const rms = Math.sqrt(wave.reduce((sum, sample) => sum + sample * sample, 0) / wave.length);
        probe.rms.push({ t: time, rms });
        const current = document.querySelector('main')?.dataset.world;
        if (world !== current) probe.world.push({ world: current, time });
        world = current;
      }, 24);
      return analyser;
    };

    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = createOscillator.call(this);
      const start = oscillator.start;
      oscillator.start = function (...args) {
        probe.pitches.push(this.frequency.value);
        return start.apply(this, args);
      };
      return oscillator;
    };

    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      probe.frames.push(performance.now());
      return clear.apply(this, args);
    };
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metric = async name => (await cdp.send('Performance.getMetrics')).metrics.find(item => item.name === name).value;

  assert.ok((await page.goto(url))?.ok(), 'The player HTML must load.');
  assert.equal(await page.title(), 'Music Universe | Afterimage');
  if (pages) {
    assert.equal(new URL(page.url()).pathname, pagesBase);
    const assets = await page.locator('script[type="module"][src], link[rel="stylesheet"][href]')
      .evaluateAll(nodes => nodes.map(node => node.src ?? node.href));
    assert.ok(assets.some(asset => new URL(asset).pathname.endsWith('.js')), 'Missing production JavaScript.');
    assert.ok(assets.some(asset => new URL(asset).pathname.endsWith('.css')), 'Missing production CSS.');
    for (const asset of assets) {
      const location = new URL(asset);
      assert.equal(location.origin, new URL(url).origin);
      assert.ok(location.pathname.startsWith(pagesBase + 'assets/'), 'Unexpected asset path: ' + asset);
      assert.ok(responses.get(asset) >= 200 && responses.get(asset) < 400, 'Asset did not load: ' + asset);
    }
    const home = await page.getByRole('link', { name: 'Music Universe home' }).getAttribute('href');
    assert.equal(new URL(home, page.url()).pathname, pagesBase + 'index.html');
  }
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Music Universe home');
  const status = page.getByRole('status').filter({ hasText: /Playing|Scheduled|Ready/ });
  const player = page.locator('main');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await page.waitForFunction(() => window.probe.rms.some(sample => sample.rms > .04));
  const liveFrame = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await page.waitForFunction(frame => document.querySelector('canvas').toDataURL() !== frame,
    liveFrame, { polling: 125, timeout: 3000 });
  const begin = await metric('Timestamp');
  const beginTasks = await metric('TaskDuration');

  await page.getByRole('button', { name: /R&B/ }).click();
  await page.getByRole('button', { name: 'Discover', exact: true }).press('Enter');
  const map = page.locator('#discover');
  assert.equal(await map.getByRole('heading', { name: 'Musical identity' }).count(), 1);
  assert.equal(await map.getByRole('heading', { name: 'Afterimage' }).count(), 1);
  assert.equal(await page.evaluate(() =>
    document.querySelector('.timeline').getAttribute('aria-valuetext').match(/Bar (\d+) of/)[1] ===
      document.querySelector('[data-testid="discover-bar"]').textContent.trim().split(' ')[0]), true);
  await map.getByRole('button', { name: /Club.*124 BPM.*Available/ }).click();
  assert.match(await status.innerText(), /Scheduled for bar 3/);
  if (process.env.MUSIC_UNIVERSE_DISCOVER_SCREENSHOT) {
    await page.screenshot({ path: process.env.MUSIC_UNIVERSE_DISCOVER_SCREENSHOT, animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  assert.match(await status.innerText(), /Scheduled for bar 3/);
  assert.equal(await page.evaluate(() => window.probe.schedulers.size), 1);
  assert.equal(await player.getAttribute('data-world'), 'intimate');
  await page.waitForFunction(() => document.querySelector('main').dataset.world === 'club', null, { timeout: 8000 });
  assert.match(await page.getByRole('progressbar').getAttribute('aria-valuetext'), /Bar 3 of 8/);
  await page.waitForFunction(() => window.probe.world.at(-1)?.world === 'club');
  assert.deepEqual(await page.evaluate(() => window.probe.world.map(record => record.world)), ['intimate', 'club']);

  if (process.env.MUSIC_UNIVERSE_SCREENSHOT) {
    await page.screenshot({ path: process.env.MUSIC_UNIVERSE_SCREENSHOT, animations: 'disabled' });
  }

  await page.getByRole('button', { name: /R&B/ }).click();
  await page.waitForFunction(() => document.querySelector('main').dataset.world === 'rnb', null, { timeout: 8000 });
  await page.getByRole('button', { name: /84 BPM.*Intimate/ }).click();
  await page.waitForFunction(() => document.querySelector('main').dataset.world === 'intimate', null, { timeout: 8000 });
  await page.waitForFunction(() => window.probe.world.length === 4 && window.probe.world.at(-1).world === 'intimate');
  await page.waitForTimeout(315);
  const end = await metric('Timestamp');
  const endTasks = await metric('TaskDuration');

  const audio = await page.evaluate(() => ({ rms: window.probe.rms, transitions: window.probe.world, frames: window.probe.frames }));
  for (const transition of audio.transitions.slice(1)) {
    const near = audio.rms.filter(sample => Math.abs(sample.t - transition.time) <= .28);
    assert.ok(near.length >= 10);
    let silence = 0;
    for (const sample of near) {
      silence = sample.rms < .001 ? silence + 1 : 0;
      assert.ok(silence < 4, 'Output went quiet for four consecutive analyser samples around a transition.');
    }
  }

  const intent = page.getByLabel('Ask for a change', { exact: false });
  await intent.fill('make this more intimate and less percussive');
  await intent.press('Enter');
  assert.equal(await page.locator('#intent-feedback').innerText(), 'intimate mood · Drums off');
  await intent.fill('make it jazz');
  await intent.press('Enter');
  assert.match(await page.locator('#intent-feedback').innerText(), /Try a world/);
  for (const layer of ['Bass', 'Keys', 'Lead', 'Pad / FX']) {
    await page.getByRole('button', { name: layer, exact: true }).click();
  }
  await page.waitForFunction(() => !document.querySelector('.status').textContent.includes('Scheduled'),
    null, { timeout: 8000 });
  await page.waitForFunction(() => window.probe.rms.slice(-6).every(sample => sample.rms < .001));
  assert.equal(await page.evaluate(() => window.probe.schedulers.size), 1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(() => window.probe.frames.length);
  await page.waitForTimeout(240);
  assert.ok(await page.evaluate(() => window.probe.frames.length) - reduced < 4);

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  assert.equal(await page.evaluate(() => window.probe.schedulers.size), 0);
  await page.getByRole('button', { name: 'Lead', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.probe.rms.slice(-8).some(sample => sample.rms > .012));
  assert.equal(await page.evaluate(() => window.probe.schedulers.size), 1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  assert.equal(await page.evaluate(() => window.probe.schedulers.size), 0);
  const mood = page.getByRole('button', { name: /^groovy$/i });
  await mood.click();
  assert.equal(await mood.getAttribute('aria-pressed'), 'true');
  await page.getByRole('slider', { name: /Energy/ }).press('End');
  assert.equal(await page.locator('.energy output').innerText(), '100%');
  const selectFile = async (name, buffer) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Open .muv', exact: true }).click(),
    ]);
    await chooser.setFiles({ name, buffer, mimeType: 'application/zip' });
  };
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await selectFile('invalid.muv', Buffer.from('not a ZIP'));
  assert.match(await page.getByRole('alert').innerText(), /Couldn’t open song.*complete/);
  assert.equal(await page.getByRole('heading', { name: 'Afterimage' }).count(), 1);
  assert.equal(await page.evaluate(() => window.probe.schedulers.size), 1);

  await selectFile('Beacon.muv', beaconPackage());
  await page.getByRole('heading', { name: 'Beacon Fixture', exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuetext'), 'Bar 1 of 4');
  assert.equal(await page.evaluate(() => window.probe.schedulers.size), 0);
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  assert.equal(await map.getByRole('button', { name: /Locked Signal.*Unavailable/ }).isDisabled(), true);
  assert.match(await map.getByText('Two-note signal').innerText(), /Two-note signal/);
  await page.evaluate(() => { window.probe.pitches.length = 0; });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.probe.pitches.some(value => Math.abs(value - 261.625565) < .01));
  await map.getByRole('button', { name: /Bright Signal.*120 BPM.*Available/ }).click();
  assert.match(await status.innerText(), /Scheduled for bar 3/);
  await page.waitForFunction(() => document.querySelector('main').dataset.world === 'club', null, { timeout: 8500 });
  await page.waitForFunction(() => window.probe.pitches.some(value => Math.abs(value - 659.255114) < .01));
  assert.match(await page.getByTestId('discover-bar').innerText(), /3 \/ 4/);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Afterimage', exact: true }).click();
  await page.getByRole('heading', { name: 'Afterimage', exact: true }).waitFor();
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuetext'), 'Bar 1 of 8');
  assert.deepEqual(errors, []);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await mobile.goto(url);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.getByRole('button', { name: 'Play', exact: true }).scrollIntoViewIfNeeded();
  await mobile.getByRole('button', { name: 'Play', exact: true }).click();
  await mobile.getByRole('button', { name: 'Pause', exact: true }).waitFor();

  await mobile.close();
  await page.close();
  await testDestinations(browser, url);

  const active = audio.frames.slice(6);
  const fps = 1000 * (active.length - 1) / (active.at(-1) - active[0]);
  console.log(JSON.stringify({
    url,
    browser: browser.version(),
    transitions: audio.transitions.map(record => record.world),
    analyserSamples: audio.rms.length,
    meanCanvasPaintsPerSecond: Number(fps.toFixed(1)),
    chromeMainThreadTaskPercent: Number((100 * (endTasks - beginTasks) / (end - begin)).toFixed(1)),
    checks: ['audio present', 'bar-3 transition', 'queue replacement', 'transition signal continuity',
      'live canvas', 'mood', 'energy', 'intent', 'all layers silent', 'reduced motion', 'pause/resume',
      'Discover round-trip and transition', 'invalid import preserves playback', 'external package plays its own notes',
      'artist permissions', 'offline analysis import and exact export', 'report scope isolation',
      'offline editable pattern audio and stop on navigation', 'external Strudel handoff and unavailable state', 'keyboard focus', 'mobile width', 'no uncaught exceptions',
      ...(pages ? ['Pages asset paths', 'no console or network errors'] : [])],
  }, null, 2));
} finally {
  await browser.close();
  await server?.close();
}
