import { instruments, moods, worlds, type Instrument, type Mood, type World } from '../vocabulary.ts';
import { beatsPerBar } from '../timing.ts';
import { isJsonPath, readStoredZip } from './zip.ts';

export const formatVersion = '0.1.0';
const transforms = ['mood-articulation', 'energy-shaping', 'layer-mix'] as const;
const voices = ['felt', 'rhodes', 'pluck', 'sub', 'round', 'drive', 'air', 'kick', 'snare', 'hat'] as const;
const gates = ['at_least', 'above', 'at_most'] as const;

type Transform = typeof transforms[number];
type Gate = typeof gates[number];
export type Voice = typeof voices[number];
export type Event = {
  at: number;
  pitch: number;
  length: number;
  velocity: number;
  instrument: Instrument;
  voice: Voice;
  pan?: number;
};
export type AuthoredEvent = Event & {
  groovy_at?: number;
  short_length?: number;
  energy_velocity?: number;
  energy_gate?: { op: Gate; value: number };
};
type Section = { id: string; label: string; start_bar: number; bars: number };
type Identity = {
  id: string; title: string; artist?: string; meter: readonly [4, 4]; key?: string; bars: number;
  harmony: readonly string[]; sections: readonly Section[]; anchors: readonly string[];
};
export type Expression = {
  id: World; label: string; bpm: number; mood: Mood; energy: number; texture?: string; energy_label?: string;
  bars: readonly (readonly AuthoredEvent[])[];
};
type Edge = { from: World; to: World };
export type Universe = {
  version: typeof formatVersion;
  identity: Identity;
  roles: readonly Instrument[];
  expressions: readonly Expression[];
  defaultExpression: World;
  possibilities: { moods: readonly Mood[]; transforms: readonly Transform[]; transitions: readonly Edge[] };
};

const decoder = new TextDecoder('utf-8', { fatal: true });
type JsonObject = Record<string, unknown>;

function fail(field: string, reason: string): never {
  throw new Error(field + ': ' + reason + '.');
}

function object(raw: unknown, field: string, allowed: readonly string[]): JsonObject {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail(field, 'expected an object');
  const result = raw as JsonObject;
  for (const key of Object.keys(result)) {
    if (!allowed.includes(key)) fail(field, 'unsupported field ' + key);
  }
  return result;
}

function items(raw: unknown, field: string, min: number, max: number): unknown[] {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) {
    fail(field, 'expected ' + (min === max ? min : min + ' to ' + max) + ' entries');
  }
  return raw;
}

function label(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || raw.trim() !== raw || raw.length < 1 || raw.length > 120 ||
      /[\u0000-\u001f\u007f]/.test(raw)) fail(field, 'expected a text label of 1 to 120 characters');
  return raw;
}

function optionalLabel(raw: unknown, field: string) {
  return raw === undefined ? undefined : label(raw, field);
}

function id(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(raw)) fail(field, 'invalid identifier');
  return raw;
}

function number(raw: unknown, field: string, min: number, max: number, integer = false): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max ||
      (integer && !Number.isInteger(raw))) fail(field, 'expected ' + (integer ? 'an integer' : 'a finite number') +
        ' from ' + min + ' to ' + max);
  return raw;
}

function choice<T extends string>(raw: unknown, field: string, options: readonly T[]): T {
  if (typeof raw !== 'string' || !options.includes(raw as T)) fail(field, 'unsupported value');
  return raw as T;
}

function unique<T extends string>(values: T[], field: string) {
  if (new Set(values).size !== values.length) fail(field, 'duplicate identifier');
  return values;
}

function json(files: ReadonlyMap<string, Uint8Array>, path: string): unknown {
  const bytes = files.get(path);
  if (!bytes) fail(path, 'missing JSON asset');
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    fail(path, 'invalid UTF-8 or JSON');
  }
}

function readIdentity(raw: unknown): Identity {
  const field = 'identity';
  const data = object(raw, field, ['id', 'title', 'artist', 'meter', 'key', 'bars', 'harmony', 'sections', 'anchors']);
  const meter = items(data.meter, 'identity.meter', 2, 2);
  if (meter[0] !== beatsPerBar || meter[1] !== 4) fail('identity.meter', 'v0.1 supports 4/4 only');
  const bars = number(data.bars, 'identity.bars', 1, 32, true);
  const harmony = data.harmony === undefined ? [] : items(data.harmony, 'identity.harmony', bars, bars)
    .map((value, i) => label(value, 'harmony bar ' + (i + 1)));
  const sections = items(data.sections, 'identity.sections', 1, bars).map((value, i) => {
    const path = 'section ' + (i + 1);
    const section = object(value, path, ['id', 'label', 'start_bar', 'bars']);
    return {
      id: id(section.id, path + ' ID'), label: label(section.label, path + ' label'),
      start_bar: number(section.start_bar, path + ' start_bar', 1, bars, true),
      bars: number(section.bars, path + ' bars', 1, bars, true),
    };
  });
  unique(sections.map(section => section.id), 'section IDs');
  let nextBar = 1;
  for (const section of sections) {
    if (section.start_bar !== nextBar) fail('identity.sections', 'sections must cover the timeline in order');
    nextBar += section.bars;
  }
  if (nextBar !== bars + 1) fail('identity.sections', 'sections must cover exactly ' + bars + ' bars');
  const anchors = items(data.anchors ?? [], 'identity.anchors', 0, 8).map(value => label(value, 'anchor'));
  return {
    id: id(data.id, 'identity.id'), title: label(data.title, 'identity.title'),
    artist: optionalLabel(data.artist, 'identity.artist'), key: optionalLabel(data.key, 'identity.key'),
    meter: [4, 4], bars, harmony, sections, anchors,
  };
}

function event(raw: unknown, field: string, roles: readonly Instrument[]): AuthoredEvent {
  const data = object(raw, field, ['at', 'pitch', 'length', 'velocity', 'instrument', 'voice', 'pan',
    'groovy_at', 'short_length', 'energy_velocity', 'energy_gate']);
  const at = (value: unknown, name: string) => {
    const beat = number(value, name, 0, beatsPerBar);
    if (beat === beatsPerBar) fail(name, 'onset must be inside the bar');
    return beat;
  };
  const duration = (value: unknown, name: string) => number(value, name, .001, 8);
  const velocity = number(data.velocity, field + ' velocity', .001, 1);
  const energyVelocity = data.energy_velocity === undefined ? undefined :
    number(data.energy_velocity, field + ' energy_velocity', -1, 1);
  if (energyVelocity !== undefined) number(velocity + energyVelocity, field + ' velocity at full energy', .001, 1);
  let energyGate: AuthoredEvent['energy_gate'];
  if (data.energy_gate !== undefined) {
    const condition = object(data.energy_gate, field + ' energy_gate', gates);
    const keys = Object.keys(condition);
    if (keys.length !== 1) fail(field + ' energy_gate', 'expected one condition');
    const op = choice(keys[0], field + ' energy_gate', gates);
    energyGate = { op, value: number(condition[op], field + ' energy threshold', 0, 1) };
  }
  const instrument = choice(data.instrument, field + ' instrument (role)', roles);
  const voice = choice(data.voice, field + ' voice', voices);
  return {
    at: at(data.at, field + ' at'),
    pitch: number(data.pitch, field + ' pitch', 0, 127, true),
    length: duration(data.length, field + ' length'), velocity, instrument, voice,
    pan: data.pan === undefined ? undefined : number(data.pan, field + ' pan', -1, 1),
    groovy_at: data.groovy_at === undefined ? undefined : at(data.groovy_at, field + ' groovy_at'),
    short_length: data.short_length === undefined ? undefined : duration(data.short_length, field + ' short_length'),
    energy_velocity: energyVelocity, energy_gate: energyGate,
  };
}

export function readUniverse(bytes: Uint8Array): Universe {
  const files = readStoredZip(bytes);
  const manifest = object(json(files, 'manifest.json'), 'manifest', ['format', 'format_version', 'identity',
    'roles', 'default_expression', 'expressions', 'possibilities']);
  if (manifest.format !== 'music-universe') fail('format', 'expected music-universe');
  if (manifest.format_version !== formatVersion) {
    fail('format_version', 'this player supports only .muv ' + formatVersion);
  }
  const identity = readIdentity(manifest.identity);
  const roles = unique(items(manifest.roles, 'roles', 1, instruments.length)
    .map(value => choice(value, 'role', instruments)), 'roles');
  const usedFiles = new Set(['manifest.json']);
  const expressions = items(manifest.expressions, 'expressions', 1, worlds.length).map((raw, i): Expression => {
    const field = 'expression ' + (i + 1);
    const data = object(raw, field, ['id', 'label', 'bpm', 'mood', 'energy', 'texture', 'energy_label', 'events']);
    if (typeof data.events !== 'string' || !isJsonPath(data.events) || data.events === 'manifest.json') {
      fail(field + ' events', 'expected a relative JSON event asset path');
    }
    usedFiles.add(data.events);
    const bars = items(json(files, data.events), data.events, identity.bars, identity.bars).map((bar, index) =>
      items(bar, data.events + ' bar ' + (index + 1), 0, 64).map((note, ordinal) =>
        event(note, data.events + ' bar ' + (index + 1) + ' note ' + (ordinal + 1), roles)));
    return {
      id: choice(data.id, field + ' ID', worlds), label: label(data.label, field + ' label'),
      bpm: number(data.bpm, field + ' BPM', 30, 240),
      mood: choice(data.mood, field + ' mood', moods), energy: number(data.energy, field + ' energy', 0, 1),
      texture: optionalLabel(data.texture, field + ' texture'),
      energy_label: optionalLabel(data.energy_label, field + ' energy label'), bars,
    };
  });
  for (const path of files.keys()) {
    if (!usedFiles.has(path)) fail(path, 'asset is not declared in the manifest');
  }
  const ids = unique(expressions.map(expression => expression.id), 'expressions');
  const defaultExpression = choice(manifest.default_expression, 'default_expression', ids);
  const data = object(manifest.possibilities, 'possibilities', ['moods', 'transforms', 'transition_bars', 'transitions']);
  if ((data.transition_bars ?? 2) !== 2) fail('transition_bars', 'only two-bar boundaries are supported');
  const allowedMoods = unique(items(data.moods ?? moods, 'possibilities.moods', 1, moods.length)
    .map(value => choice(value, 'allowed mood', moods)), 'possibilities.moods');
  if (expressions.some(expression => !allowedMoods.includes(expression.mood))) {
    fail('possibilities.moods', 'must include each expression’s default mood');
  }
  const allowedTransforms = unique(items(data.transforms ?? [], 'possibilities.transforms', 0, transforms.length)
    .map(value => choice(value, 'transformation', transforms)), 'possibilities.transforms');
  const transitions = items(data.transitions ?? [], 'possibilities.transitions', 0, 6).map(value => {
    const edge = object(value, 'transition', ['from', 'to']);
    const from = choice(edge.from, 'transition from', ids);
    const to = choice(edge.to, 'transition to', ids);
    if (from === to) fail('transition', 'source and target must differ');
    return { from, to };
  });
  unique(transitions.map(({ from, to }) => from + ' → ' + to), 'transitions');
  return {
    version: formatVersion, identity, roles, expressions, defaultExpression,
    possibilities: { moods: allowedMoods, transforms: allowedTransforms, transitions },
  };
}

export function expressionFor(song: Universe, world: World): Expression {
  const found = song.expressions.find(expression => expression.id === world);
  if (!found) throw new Error('This song does not contain the ' + world + ' world.');
  return found;
}

export function canTransition(song: Universe, from: World, to: World): boolean {
  return from === to || song.possibilities.transitions.some(edge => edge.from === from && edge.to === to);
}
