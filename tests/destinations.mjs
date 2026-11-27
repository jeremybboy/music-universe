import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beaconPackage } from './fixtures.mjs';

const report = readFileSync(new URL('./fixtures/synthetic-analysis-v1.json', import.meta.url));
const data = JSON.parse(report);
const pattern = readFileSync(new URL('../music/renditions/afterimage-intimate.strudel', import.meta.url), 'utf8');
const minimal = Buffer.from(JSON.stringify({
  schema_version: 1, source: 'Minimal synthetic excerpt', excerpt: { start_s: 4, duration_s: 2, sample_rate_hz: 48000 },
}));

export async function testDestinations(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const nav = name => page.getByRole('navigation', { name: 'Player view' }).getByRole('button', { name, exact: true });
  const play = page.getByRole('button', { name: 'Play', exact: true });
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  async function choose(button, name, buffer, mimeType = 'application/json') {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'), page.getByRole('button', { name: button, exact: true }).click(),
    ]);
    await chooser.setFiles({ name, buffer, mimeType });
  }
  const importReport = (name, buffer) => choose('Import analysis report', name, buffer);
  await page.addInitScript(() => {
    window.patternAudition = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (this instanceof DynamicsCompressorNode && destination instanceof AudioDestinationNode) {
        const observer = this.context.createAnalyser();
        connect.call(this, observer);
        connect.call(observer, destination);
        window.patternAudition.push(observer);
        return destination;
      }
      return connect.call(this, destination, ...args);
    };
  });
  try {
    await page.goto(url);
    await play.click();
    await page.waitForFunction(() => Number(document.querySelector('.timeline').getAttribute('aria-valuenow')) >= 3);
    const before = Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'));
    await nav('Discover').click();
    await nav('Song Analysis').click();
    await pause.waitFor();
    assert.ok(Number(await page.getByRole('progressbar').getAttribute('aria-valuenow')) >= before);
    await context.setOffline(true);
    await importReport('local-file.json', report);
    await page.getByRole('heading', { name: 'Confirm report association' }).waitFor();
    await page.getByText('No report attached', { exact: true }).waitFor();
    await page.getByLabel('Attach to').selectOption('intimate');
    await page.getByRole('button', { name: 'Attach report', exact: true }).click();
    await page.getByRole('heading', { name: 'synthetic-pulse.wav', exact: true }).waitFor();
    await pause.waitFor();
    assert.equal(await page.getByRole('table', { name: 'CLAP2 scores' }).locator('tbody tr').count(),
      data.semantics.prompt_similarity.length);
    assert.equal(await page.getByRole('table', { name: 'Stereo vs. estimated groups' }).locator('tbody tr').count(), 5);
    await page.getByText('Audio embedding retained · 224 values').waitFor();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download report JSON' }).click(),
    ]);
    assert.deepEqual(readFileSync(await download.path()), report);
    if (process.env.MUSIC_UNIVERSE_ANALYSIS_SCREENSHOT) {
      await page.screenshot({ path: process.env.MUSIC_UNIVERSE_ANALYSIS_SCREENSHOT, fullPage: true });
    }

    await importReport('bad.json', Buffer.from('{invalid'));
    await page.getByRole('alert').filter({ hasText: /valid UTF-8/ }).waitFor();
    await importReport('large.json', Buffer.alloc(2 * 1024 * 1024 + 1));
    await page.getByRole('alert').filter({ hasText: /2 MiB/ }).waitFor();
    await page.getByRole('heading', { name: 'synthetic-pulse.wav', exact: true }).waitFor();
    await pause.waitFor();
    await pause.click();

    await nav('Listen').click();
    await page.getByRole('button', { name: /124 BPM.*Club/ }).click();
    await nav('Song Analysis').click();
    await page.getByText('No report attached', { exact: true }).waitFor();
    await importReport('minimal.json', minimal);
    await page.getByRole('button', { name: 'Attach report', exact: true }).click();
    await page.getByRole('heading', { name: 'Minimal synthetic excerpt', exact: true }).waitFor();
    await nav('Strudel Player').click();
    await page.getByRole('heading', { name: /No rendition.*Club/ }).waitFor();
    const code = page.getByRole('textbox', { name: 'Pattern code' });
    const run = page.getByRole('button', { name: 'Run pattern', exact: true });
    await code.fill('setcps(120/60/4)\n$: note("a4 c5 e5 a5").s("sine")');
    await play.click();
    await pause.waitFor();
    await run.click();
    await play.waitFor();
    await page.waitForFunction(() => {
      const analyser = window.patternAudition.at(-1);
      if (!analyser) return false;
      const wave = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(wave);
      return wave.some(sample => Math.abs(sample) > .01);
    });
    await code.fill('window.alert("This must never execute")');
    await page.getByRole('button', { name: 'Restart pattern', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /Each track starts/ }).waitFor();
    await nav('Listen').click();
    await page.waitForFunction(() => {
      const analyser = window.patternAudition.at(-1);
      const wave = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(wave);
      return wave.every(sample => Math.abs(sample) < .001);
    });
    await nav('Strudel Player').click();
    await run.waitFor();

    await choose('Open .muv', 'Beacon.muv', beaconPackage(), 'application/zip');
    await page.getByRole('heading', { name: /No rendition.*Beacon/ }).waitFor();
    await nav('Song Analysis').click();
    await page.getByText('No report attached', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Afterimage', exact: true }).click();
    await page.getByRole('heading', { name: 'Minimal synthetic excerpt', exact: true }).waitFor();
    await page.getByLabel('Show report').selectOption('intimate');
    await page.getByRole('heading', { name: 'synthetic-pulse.wav', exact: true }).waitFor();

    await nav('Strudel Player').click();
    const launch = page.getByRole('button', { name: 'Open in Strudel', exact: true });
    let externalRequests = 0;
    await context.route('https://strudel.cc/**', async route => {
      externalRequests++;
      await route.fulfill({ contentType: 'text/html', body: '<title>Strudel test tab</title>' });
    });
    await context.setOffline(false);
    await launch.waitFor();
    await page.getByRole('button', { name: 'Load Afterimage pattern', exact: true }).click();
    assert.equal(await page.getByRole('alert').filter({ hasText: /Each track starts/ }).count(), 0);
    assert.equal(externalRequests, 0);
    if (process.env.MUSIC_UNIVERSE_STRUDEL_SCREENSHOT) {
      await page.screenshot({ path: process.env.MUSIC_UNIVERSE_STRUDEL_SCREENSHOT, fullPage: true });
    }
    await play.click();
    const [tab] = await Promise.all([context.waitForEvent('page'), launch.click()]);
    await tab.waitForLoadState();
    const opened = new URL(tab.url());
    assert.equal(opened.origin, 'https://strudel.cc');
    assert.equal(Buffer.from(decodeURIComponent(opened.hash.slice(1)), 'base64').toString('utf8'), pattern);
    assert.equal(externalRequests, 1);
    assert.ok(await play.isDisabled());
    await nav('Listen').click();
    assert.ok(await play.isDisabled());
    await tab.close();
    await page.getByRole('button', { name: 'I stopped Strudel', exact: true }).click();
    await play.click();
    await pause.waitFor();
    await pause.click();
    assert.deepEqual(errors, []);

    await page.setViewportSize({ width: 390, height: 844 });
    await nav('Song Analysis').click();
    await page.getByRole('heading', { name: 'Song Analysis', exact: true }).waitFor();
    const mobileFits = async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth &&
      Array.from(document.querySelectorAll('.player-nav button')).every(button => button.getBoundingClientRect().right <= innerWidth));
    assert.ok(await mobileFits());
    await nav('Strudel Player').click();
    await launch.waitFor();
    assert.ok(await mobileFits());
  } finally {
    await context.close();
  }
}
