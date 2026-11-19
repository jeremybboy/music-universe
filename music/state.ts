export const worlds = ['intimate', 'rnb', 'club'] as const;
export const moods = ['relaxed', 'intimate', 'groovy', 'energetic'] as const;
export const instruments = ['drums', 'bass', 'keys', 'lead', 'pad'] as const;

export type World = typeof worlds[number];
export type Mood = typeof moods[number];
export type Instrument = typeof instruments[number];
export type Layers = Record<Instrument, boolean>;
export type MusicConfig = { world: World; mood: Mood; energy: number; layers: Layers };
export type MusicConfigPatch = Partial<Omit<MusicConfig, 'layers'>> & { layers?: Partial<Layers> };
export type IntentResult = { ok: true; patch: MusicConfigPatch } | { ok: false; message: string };
export type IntentAdapter = (text: string, current: MusicConfig) => IntentResult | Promise<IntentResult>;

export const worldInfo = {
  intimate: { label: 'Intimate', bpm: 84, mood: 'relaxed', energy: 0.3, texture: 'Felt keys · brush pulse' },
  rnb: { label: 'R&B', bpm: 95, mood: 'groovy', energy: 0.58, texture: 'Warm keys · syncopated bass' },
  club: { label: 'Club', bpm: 124, mood: 'energetic', energy: 0.82, texture: 'Floor kick · prismatic synths' },
} as const;
export const instrumentLabels = { drums: 'Drums', bass: 'Bass', keys: 'Keys', lead: 'Lead', pad: 'Pad / FX' };

export function preset(world: World): MusicConfig {
  const { mood, energy } = worldInfo[world];
  return { world, mood, energy, layers: { drums: true, bass: true, keys: true, lead: true, pad: true } };
}

export function resolvePatch(current: MusicConfig, patch: MusicConfigPatch): MusicConfig {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
    Object.keys(patch).some(key => !['world', 'mood', 'energy', 'layers'].includes(key))) {
    throw new Error('Unknown music setting.');
  }
  if (patch.world !== undefined && !worlds.includes(patch.world)) throw new Error('Unknown world.');
  if (patch.mood !== undefined && !moods.includes(patch.mood)) throw new Error('Unknown mood.');
  if (patch.energy !== undefined && (!Number.isFinite(patch.energy) || patch.energy < 0 || patch.energy > 1)) {
    throw new Error('Energy must be between 0 and 1.');
  }
  if (patch.layers !== undefined && (!patch.layers || typeof patch.layers !== 'object' || Array.isArray(patch.layers))) {
    throw new Error('Expected a map of layer settings.');
  }
  for (const [name, value] of Object.entries(patch.layers ?? {})) {
    if (!instruments.includes(name as Instrument) || typeof value !== 'boolean') throw new Error('Unknown layer setting.');
  }
  const base = patch.world === undefined || patch.world === current.world ? current : preset(patch.world);
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

export function parseIntent(text: string, current: MusicConfig): IntentResult {
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
  if (take(/\b(intimate world|original)\b/)) patch.world = 'intimate';
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
    const base = patch.world && patch.world !== current.world ? preset(patch.world) : current;
    const change = ['more', 'higher'].includes(relative[1]) ? 0.2 : -0.2;
    patch.energy = Math.max(0, Math.min(1, Math.round((base.energy + change) * 100) / 100));
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
  return { ok: true, patch };
}

export function describePatch(patch: MusicConfigPatch): string {
  const changes: string[] = [];
  if (patch.world) changes.push(worldInfo[patch.world].label);
  if (patch.mood) changes.push(patch.mood + ' mood');
  if (patch.energy !== undefined) changes.push(Math.round(patch.energy * 100) + '% energy');
  for (const layer of instruments) {
    if (patch.layers?.[layer] !== undefined) changes.push(instrumentLabels[layer] + (patch.layers[layer] ? ' on' : ' off'));
  }
  return changes.join(' · ');
}
