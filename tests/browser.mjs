import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  channel: process.env.MUSIC_UNIVERSE_BROWSER || undefined,
}).catch(async error => {
  await server.close();
  throw error;
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.addInitScript(() => {
    const probe = { rms: [], world: [], frames: [], schedulers: new Set() };
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

    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      probe.frames.push(performance.now());
      return clear.apply(this, args);
    };
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metric = async name => (await cdp.send('Performance.getMetrics')).metrics.find(item => item.name === name).value;

  await page.goto(url);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Music Universe home');
  const status = page.getByRole('status').filter({ hasText: /Playing|Scheduled|Ready/ });
  const player = page.locator('main');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await page.waitForFunction(() => window.probe.rms.some(sample => sample.rms > .04));
  const begin = await metric('Timestamp');
  const beginTasks = await metric('TaskDuration');

  await page.getByRole('button', { name: /R&B/ }).click();
  await page.getByRole('button', { name: /124 BPM.*Club/ }).click();
  assert.match(await status.innerText(), /Scheduled for bar 3/);
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
  assert.deepEqual(errors, []);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await mobile.goto(url);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.getByRole('button', { name: 'Play', exact: true }).scrollIntoViewIfNeeded();
  await mobile.getByRole('button', { name: 'Play', exact: true }).click();
  await mobile.getByRole('button', { name: 'Pause', exact: true }).waitFor();

  const active = audio.frames.slice(6);
  const fps = 1000 * (active.length - 1) / (active.at(-1) - active[0]);
  console.log(JSON.stringify({
    browser: browser.version(),
    transitions: audio.transitions.map(record => record.world),
    analyserSamples: audio.rms.length,
    meanCanvasPaintsPerSecond: Number(fps.toFixed(1)),
    chromeMainThreadTaskPercent: Number((100 * (endTasks - beginTasks) / (end - begin)).toFixed(1)),
    checks: ['audio present', 'bar-3 transition', 'queue replacement', 'transition signal continuity',
      'intent', 'all layers silent', 'reduced motion', 'pause/resume', 'keyboard focus', 'mobile width'],
  }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
