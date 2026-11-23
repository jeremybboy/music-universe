import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { eventsForBar } from '../music/composition.ts';
import { parseIntent, preset, resolvePatch } from '../music/state.ts';
import { Transport } from '../music/transport.ts';
import { canTransition, readUniverse } from '../music/universe/model.ts';
import { isJsonPath, maxEntryBytes, maxPackageBytes, readStoredZip, writeStoredZip } from '../music/universe/zip.ts';
import { beaconFiles, beaconPackage } from './fixtures.mjs';

const utf8 = (value: unknown) => Buffer.from(JSON.stringify(value));
const shipped = new URL('../songs/Afterimage.muv', import.meta.url);

function changedManifest(change: (manifest: any) => void) {
  const files = beaconFiles();
  const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8'));
  change(manifest);
  files.set('manifest.json', utf8(manifest));
  return writeStoredZip(files);
}

function changedEvent(change: (note: any) => void) {
  const files = beaconFiles();
  const bars = JSON.parse(files.get('quiet.json')!.toString('utf8'));
  change(bars[0][0]);
  files.set('quiet.json', utf8(bars));
  return writeStoredZip(files);
}

test('the packaged Afterimage is reproducible from the canonical JSON', () => {
  execFileSync(process.execPath, ['scripts/pack-muv.mjs', '--check']);
  assert.equal(readUniverse(readFileSync(shipped)).identity.title, 'Afterimage');
});

test('a second package uses its own identity, default tempo and playable notes', () => {
  const song = readUniverse(beaconPackage());
  const original = readUniverse(readFileSync(shipped));
  assert.equal(song.identity.title, 'Beacon Fixture');
  assert.equal(song.identity.bars, 4);
  assert.equal(song.expressions[0].bpm, 90);
  assert.deepEqual(song.roles, ['lead']);
  const quiet = eventsForBar(song, 0, preset(song));
  const bright = eventsForBar(song, 0, preset(song, 'club'));
  assert.deepEqual(quiet.map(note => note.pitch), [60, 60, 60]);
  assert.deepEqual(bright.map(note => note.pitch), [72, 72, 72]);
  assert.notDeepEqual(quiet, eventsForBar(original, 0, preset(original)));
});

test('artist permissions apply to direct changes and text requests', () => {
  const song = readUniverse(beaconPackage());
  const config = preset(song);
  assert.ok(canTransition(song, 'intimate', 'club'));
  assert.ok(!canTransition(song, 'intimate', 'rnb'));
  assert.throws(() => resolvePatch(song, config, { world: 'rnb' }), /artist did not allow/);
  assert.throws(() => resolvePatch(song, config, { mood: 'groovy' }), /unavailable/);
  assert.throws(() => resolvePatch(song, config, { layers: { drums: false } }), /unavailable/);
  assert.equal(parseIntent(song, 'switch to R&B', config).ok, false);
  assert.equal(parseIntent(song, 'energy 73%', config).ok, true);
  const transport = new Transport(song);
  assert.throws(() => transport.change({ world: 'rnb' }), /artist did not allow/);
  assert.equal(transport.snapshot().config.world, 'intimate');
});

test('manifest validation rejects unsupported versions, duplicate IDs and invalid timelines', () => {
  for (const [edit, reason] of [
    [(m: any) => { m.format_version = '1.0.0'; }, /supports only/],
    [(m: any) => { m.identity.meter = [3, 4]; }, /4\/4/],
    [(m: any) => { m.expressions[1].id = m.expressions[0].id; }, /duplicate/],
    [(m: any) => { m.expressions[0].bpm = 0; }, /BPM/],
    [(m: any) => { m.identity.sections[1].start_bar = 1; }, /cover the timeline/],
    [(m: any) => { m.expressions[0].events = 'missing.json'; }, /missing JSON asset/],
    [(m: any) => { m.expressions[0].events = '../quiet.json'; }, /relative JSON/],
    [(m: any) => { m.possibilities.transforms.push('time-stretch'); }, /transformation/],
    [(m: any) => { m.possibilities.transition_bars = 1; }, /two-bar/],
  ] as const) {
    assert.throws(() => readUniverse(changedManifest(edit)), reason);
  }
});

test('event validation rejects malformed values, undeclared roles and unsupported voices', () => {
  for (const [field, value, reason] of [
    ['at', 4, /inside the bar/], ['pitch', 128, /pitch/], ['length', 0, /length/],
    ['velocity', Infinity, /velocity/], ['pan', -2, /pan/], ['instrument', 'drums', /role/],
    ['voice', 'unsafe', /voice/], ['energy_gate', { always: 1 }, /unsupported field/],
  ] as const) assert.throws(() => readUniverse(changedEvent(note => { note[field] = value; })), reason);
});

test('ZIP validation enforces path, entry count, size, method, consistency and checksum limits', () => {
  for (const path of ['../manifest.json', '/manifest.json', 'events/../item.json', 'C:/item.json',
    'events\\part.json', 'events//part.json', 'audio.wav']) assert.equal(isJsonPath(path), false);
  assert.throws(() => readStoredZip(new Uint8Array(maxPackageBytes + 1)), /512 KiB/);
  assert.throws(() => writeStoredZip(new Map([['manifest.json', new Uint8Array(maxEntryBytes + 1)]])), /too large/);
  const files = Array.from({ length: 17 }, (_, i) => [i + '.json', Buffer.from('{}')] as const);
  assert.throws(() => writeStoredZip(new Map(files)), /16 JSON files/);
  const bad = beaconPackage();
  assert.throws(() => readStoredZip(bad.subarray(0, -5)), /complete/);
  const central = bad.readUInt32LE(bad.length - 6);
  const storedMethod = bad.readUInt16LE(central + 10);
  bad.writeUInt16LE(8, central + 10);
  assert.throws(() => readStoredZip(bad), /compressed entries/);
  bad.writeUInt16LE(storedMethod, central + 10);
  bad[30 + bad.readUInt16LE(26)] ^= 1;
  assert.throws(() => readStoredZip(bad), /Damaged ZIP entry/);
});

test('a failed package load never replaces the active song', () => {
  const original = readUniverse(readFileSync(shipped));
  const transport = new Transport(original);
  transport.change({ world: 'club', energy: .41 });
  const before = transport.snapshot();
  assert.throws(() => transport.replaceSong(readUniverse(Uint8Array.of(1, 2, 3))), /complete/);
  assert.deepEqual(transport.snapshot(), before);
  transport.replaceSong(readUniverse(beaconPackage()));
  assert.equal(transport.snapshot().beat, 0);
  assert.equal(transport.snapshot().config.world, 'intimate');
});
