import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compilePattern } from '../music/pattern.ts';

test('the authored pattern compiles to eight 84 BPM cycles and retains chords', () => {
  const text = readFileSync(new URL('../music/renditions/afterimage-intimate.strudel', import.meta.url), 'utf8');
  const compiled = compilePattern(text);
  assert.equal(compiled.secondsPerCycle, 240 / 84);
  assert.equal(compiled.cycles.length, 8);
  assert.deepEqual(compiled.cycles[0].filter(event => event.at === 0).map(event => event.pitch), [69, 57, 60, 64, 45]);
});

test('alternate cycles and local drums can be edited without running JavaScript', () => {
  const compiled = compilePattern('setcps(0.5)\n$: note("<c4 db5>").s("sine")\n$: s("bd ~ [hh sd]").gain(.3)');
  assert.equal(compiled.secondsPerCycle, 2);
  assert.deepEqual(compiled.cycles[1].map(event => event.pitch), [73, 'bd', 'hh', 'sd']);
  assert.ok(Math.abs(compiled.cycles[1][3].at - 5 / 6) < 1e-9);
  assert.throws(() => compilePattern('fetch("https://example.org")'), /Offline tracks start/);
  assert.throws(() => compilePattern('const phrase = note("c4"); phrase'), /JavaScript declarations.*Choose Open in Strudel/);
  assert.throws(() => compilePattern('note("c4").unknown(4)'), /Unsupported setting/);
  assert.throws(() => compilePattern('note("[c4")'), /unclosed/);
  assert.throws(() => compilePattern('note("c4").lpf(9999999999)'), /lpf must be/);
});
