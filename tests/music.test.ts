import assert from 'node:assert/strict';
import test from 'node:test';
import { composition, eventsForBar, secondsPerBeat } from '../music/composition.ts';
import { instruments, parseIntent, preset, resolvePatch, worldInfo, worlds } from '../music/state.ts';
import { beatAt, nextBoundaryBar } from '../music/timing.ts';

test('the same authored motif and harmonic structure anchor the three worlds', () => {
  assert.deepEqual(composition.meter, [4, 4]);
  assert.equal(composition.bars, 8);
  assert.deepEqual(composition.chords, ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G']);
  assert.deepEqual(worlds.map(world => worldInfo[world].bpm), [84, 95, 124]);
  for (let bar = 0; bar < composition.bars; bar++) {
    for (const world of worlds) {
      const events = eventsForBar(bar, preset(world));
      assert.deepEqual(events, eventsForBar(bar + 8, preset(world)));
      assert.deepEqual(events.filter(event => event.instrument === 'lead').map(event => event.pitch),
        composition.motif[bar].map(note => note.pitch));
      assert.deepEqual(new Set(events.map(note => note.instrument)), new Set(instruments));
      assert.ok(events.every(note => note.at >= 0 && note.at < 4 &&
        Number.isInteger(note.pitch) && note.length > 0 && note.velocity > 0 && note.velocity <= 1));
    }
  }
});

test('world, energy and mood produce distinct patterns and articulation', () => {
  const kicks = worlds.map(world => eventsForBar(0, preset(world))
    .filter(note => note.voice === 'kick').map(note => note.at));
  assert.deepEqual(kicks, [[0, 2.5], [0, .75, 2.25, 3.25], [0, 1, 2, 3]]);
  assert.deepEqual(worlds.map(world => eventsForBar(0, preset(world)).find(note => note.instrument === 'lead')?.voice),
    ['felt', 'rhodes', 'pluck']);
  const base = preset('rnb');
  const quieter = eventsForBar(0, resolvePatch(base, { energy: .2 }));
  assert.ok(quieter.filter(note => note.instrument === 'keys').length <
    eventsForBar(0, base).filter(note => note.instrument === 'keys').length);
  const intimate = eventsForBar(0, resolvePatch(base, { mood: 'intimate' }));
  assert.ok(intimate.find(note => note.instrument === 'lead')!.length >
    eventsForBar(0, base).find(note => note.instrument === 'lead')!.length);
});

test('each mute removes its scheduled part and persists across worlds', () => {
  const base = preset('intimate');
  for (const layer of instruments) {
    const changed = resolvePatch(base, { layers: { [layer]: false } });
    assert.equal(base.layers[layer], true);
    const switched = resolvePatch(changed, { world: 'club' });
    assert.equal(switched.layers[layer], false);
    assert.ok(!eventsForBar(0, switched).some(note => note.instrument === layer));
  }
});

test('invalid config patches are rejected', () => {
  for (const bad of [{ energy: -1 }, { energy: NaN }, { energy: 1.01 }, { world: 'jazz' },
    { mood: 'happy' }, { layers: { vocals: true } }, { layers: { bass: 'off' } },
    { layers: null }, { layers: [] }, { bpm: 120 }]) {
    assert.throws(() => resolvePatch(preset('intimate'), bad as never));
  }
});

test('offline intent resolves compound settings and rejects unsupported requests in full', () => {
  const base = preset('intimate');
  assert.deepEqual(parseIntent('Make this more intimate and less percussive', base),
    { ok: true, patch: { mood: 'intimate', layers: { drums: false } } });
  assert.deepEqual(parseIntent('Switch to R&B and set energy to 65%', base),
    { ok: true, patch: { world: 'rnb', energy: .65 } });
  assert.deepEqual(parseIntent('Make it club and more energetic', base),
    { ok: true, patch: { world: 'club', mood: 'energetic' } });
  assert.deepEqual(parseIntent('club and lower energy', base),
    { ok: true, patch: { world: 'club', energy: .62 } });
  for (const text of ['', 'jazz', 'club and add vocals', 'not club', 'energy 101%', 'mute drums and add drums']) {
    assert.equal(parseIntent(text, base).ok, false, text);
  }
});

test('a tempo switch retains the absolute beat; an armed boundary advances requests to the next pair', () => {
  const start = { time: 3, beat: 0, secondsPerBeat: secondsPerBeat(preset('intimate')) };
  const boundaryTime = start.time + 8 * start.secondsPerBeat;
  const club = { time: boundaryTime, beat: 8, secondsPerBeat: secondsPerBeat(preset('club')) };
  assert.ok(Math.abs(beatAt(start, boundaryTime) - 8) < 1e-10);
  assert.equal(beatAt(club, boundaryTime), 8);
  assert.ok(Math.abs(beatAt(club, boundaryTime + club.secondsPerBeat) - 9) < 1e-10);
  assert.equal(nextBoundaryBar(7.9, 2), 2);
  assert.equal(nextBoundaryBar(7.9, 3), 4);
  assert.equal(nextBoundaryBar(31.9, 8), 8);
  assert.equal(nextBoundaryBar(32, 9), 10);
});
