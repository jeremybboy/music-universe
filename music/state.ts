import { canTransition, expressionFor, type Universe } from './universe/model.ts';
import { instrumentLabels, instruments, type Instrument, type Mood, type World } from './vocabulary.ts';

export { instrumentLabels, instruments, moods, worlds } from './vocabulary.ts';
export type { Instrument, Mood, World } from './vocabulary.ts';

export type Layers = Record<Instrument, boolean>;
export type MusicConfig = { world: World; mood: Mood; energy: number; layers: Layers };
export type MusicConfigPatch = Partial<Omit<MusicConfig, 'layers'>> & { layers?: Partial<Layers> };
export type IntentResult = { ok: true; patch: MusicConfigPatch } | { ok: false; message: string };
export type IntentAdapter = (text: string, current: MusicConfig) => IntentResult | Promise<IntentResult>;

export function preset(song: Universe, world: World = song.defaultExpression): MusicConfig {
  const { mood, energy } = expressionFor(song, world);
  const layers: Layers = { drums: false, bass: false, keys: false, lead: false, pad: false };
  for (const role of song.roles) layers[role] = true;
  return { world, mood, energy, layers };
}

export function resolvePatch(song: Universe, current: MusicConfig, patch: MusicConfigPatch,
  origin: World = current.world): MusicConfig {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
    Object.keys(patch).some(key => !['world', 'mood', 'energy', 'layers'].includes(key))) {
    throw new Error('Unknown music setting.');
  }
  if (patch.world !== undefined) {
    const target = expressionFor(song, patch.world);
    if (!canTransition(song, origin, target.id)) {
      throw new Error('The artist did not allow a direct switch to ' + target.label + ' from this world.');
    }
  }
  if (patch.mood !== undefined &&
      (!song.possibilities.transforms.includes('mood-articulation') || !song.possibilities.moods.includes(patch.mood))) {
    throw new Error('This mood control is unavailable for the current song.');
  }
  if (patch.energy !== undefined && !song.possibilities.transforms.includes('energy-shaping')) {
    throw new Error('Energy control is unavailable for the current song.');
  }
  if (patch.energy !== undefined && (!Number.isFinite(patch.energy) || patch.energy < 0 || patch.energy > 1)) {
    throw new Error('Energy must be between 0 and 1.');
  }
  if (patch.layers !== undefined && (!patch.layers || typeof patch.layers !== 'object' || Array.isArray(patch.layers))) {
    throw new Error('Expected a map of layer settings.');
  }
  for (const [name, value] of Object.entries(patch.layers ?? {})) {
    if (!song.possibilities.transforms.includes('layer-mix') ||
        !song.roles.includes(name as Instrument) || typeof value !== 'boolean') {
      throw new Error('This layer control is unavailable for the current song.');
    }
  }
  const base = patch.world === undefined || patch.world === current.world ? current : preset(song, patch.world);
  return {
    world: base.world,
    mood: patch.mood ?? base.mood,
    energy: patch.energy ?? base.energy,
    layers: { ...current.layers, ...patch.layers },
  };
}

export function sameConfig(a: MusicConfig, b: MusicConfig) {
  return a.world === b.world && a.mood === b.mood && a.energy === b.energy &&
    instruments.every(layer => a.layers[layer] === b.layers[layer]);
}

export function parseIntent(song: Universe, text: string, current: MusicConfig,
  origin: World = current.world): IntentResult {
  let remaining = text.toLowerCase().trim().replace(/r\s*(?:&|and|n)\s*b\b|\brnb\b/g, 'rnb')
    .replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ');
  const patch: MusicConfigPatch = {};
  const take = (expression: RegExp) => {
    const match = remaining.match(expression);
    if (match) remaining = remaining.replace(expression, ' ');
    return match;
  };

  const mood = take(/\b(?:more|mood(?: to)?|feel) (relaxed|intimate|groovy|energetic)\b/);
  if (mood) patch.mood = mood[1] as Mood;
  const original = take(/\b(intimate world|original)\b/);
  if (original) patch.world = original[1] === 'original' ? song.defaultExpression : 'intimate';
  const world = take(/\b(club|rnb)\b/);
  if (world && patch.world) return { ok: false, message: 'Choose one world per request.' };
  if (world) patch.world = world[1] as World;
  const bareMood = take(/\b(relaxed|intimate|groovy|energetic)\b/);
  if (bareMood && (mood || (bareMood[1] === 'intimate' && patch.world))) {
    return { ok: false, message: 'Choose one mood and one world per request.' };
  }
  if (bareMood?.[1] === 'intimate') patch.world = 'intimate';
  else if (bareMood) patch.mood = bareMood[1] as Mood;

  const energy = take(/\benergy(?: to| at)? (\d{1,3})(?:\s*%|\b)/);
  const relative = take(/\b(more|less|higher|lower) energy\b/);
  if (energy) {
    patch.energy = Number(energy[1]) / 100;
    if (patch.energy > 1 || relative) return { ok: false, message: 'Choose one energy value from 0 to 100%.' };
  }
  if (relative) {
    const base = patch.world && patch.world !== current.world ?
      song.expressions.find(expression => expression.id === patch.world)?.energy ?? current.energy : current.energy;
    const change = ['more', 'higher'].includes(relative[1]) ? 0.2 : -0.2;
    patch.energy = Math.max(0, Math.min(1, Math.round((base + change) * 100) / 100));
  }

  if (take(/\bless percussive\b/)) patch.layers = { drums: false };
  for (const layer of instruments) {
    const signal = take(new RegExp('\\b(mute|unmute|remove|add|less|more|no|without|enable|disable) ' + layer + '\\b'));
    if (signal) {
      patch.layers ??= {};
      const enabled = ['unmute', 'add', 'more', 'enable'].includes(signal[1]);
      if (patch.layers[layer] !== undefined && patch.layers[layer] !== enabled) {
        return { ok: false, message: 'Choose one setting for each instrument.' };
      }
      patch.layers[layer] = enabled;
    }
  }

  const leftover = remaining.replace(/\b(make|it|this|switch|to|and|please|set|can|you|the|world)\b/g, '').trim();
  if (leftover || !Object.keys(patch).length) {
    return { ok: false, message: 'Try a world, mood, energy percentage, or layer command such as “mute drums”.' };
  }
  try {
    resolvePatch(song, current, patch, origin);
    return { ok: true, patch };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Unsupported change.' };
  }
}

export function describePatch(song: Universe, patch: MusicConfigPatch): string {
  const changes: string[] = [];
  if (patch.world) changes.push(expressionFor(song, patch.world).label);
  if (patch.mood) changes.push(patch.mood + ' mood');
  if (patch.energy !== undefined) changes.push(Math.round(patch.energy * 100) + '% energy');
  for (const layer of instruments) {
    if (patch.layers?.[layer] !== undefined) changes.push(instrumentLabels[layer] + (patch.layers[layer] ? ' on' : ' off'));
  }
  return changes.join(' · ');
}
