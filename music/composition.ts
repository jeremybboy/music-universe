import { worldInfo, type Instrument, type MusicConfig } from './state.ts';

type Note = { at: number; pitch: number; length: number; velocity: number };
export type Voice = 'felt' | 'rhodes' | 'pluck' | 'sub' | 'round' | 'drive' | 'air' | 'kick' | 'snare' | 'hat';
export type Event = Note & { instrument: Instrument; voice: Voice; pan?: number };

const phrase = (notes: number[][]): Note[] =>
  notes.map(([at, pitch, length, velocity]) => ({ at, pitch, length, velocity }));

export const composition = {
  id: 'afterimage',
  title: 'Afterimage',
  meter: [4, 4],
  key: 'A minor',
  bars: 8,
  chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'],
  motif: [
    phrase([[0, 69, .55, .83], [.75, 72, .22, .62], [1.5, 76, 1.02, .88], [3, 74, .6, .69]]),
    phrase([[.25, 72, .85, .75], [1.5, 69, .4, .61], [2.25, 65, 1.23, .68]]),
    phrase([[0, 67, .55, .8], [.75, 72, .22, .63], [1.5, 76, 1.03, .88], [3.25, 79, .38, .73]]),
    phrase([[.25, 74, .8, .75], [1.5, 71, .43, .66], [2.5, 67, .98, .62]]),
    phrase([[0, 69, .55, .83], [.75, 72, .22, .62], [1.5, 76, .98, .88], [3, 81, .58, .78]]),
    phrase([[.25, 77, .8, .75], [1.5, 76, .4, .65], [2.25, 72, 1.25, .73]]),
    phrase([[0, 67, .55, .8], [.75, 72, .22, .63], [1.5, 76, .98, .88], [3.25, 74, .4, .73]]),
    phrase([[.25, 71, .76, .75], [1.5, 74, .42, .68], [2.5, 69, 1.03, .74]]),
  ],
} as const;

const harmony = [
  { root: 45, keys: [57, 60, 64, 71] },
  { root: 41, keys: [57, 60, 64, 65] },
  { root: 36, keys: [55, 59, 60, 64] },
  { root: 43, keys: [55, 59, 62, 69] },
];

const instrumentsByWorld = {
  intimate: { lead: 'felt', keys: 'felt', bass: 'sub', keysAt: [0, 2.5], swing: .012 },
  rnb: { lead: 'rhodes', keys: 'rhodes', bass: 'round', keysAt: [.25, 1.75, 3.25], swing: .065 },
  club: { lead: 'pluck', keys: 'pluck', bass: 'drive', keysAt: [.5, 1.5, 2.5, 3.5], swing: .002 },
} as const;

export function eventsForBar(absoluteBar: number, config: MusicConfig): Event[] {
  const bar = absoluteBar % composition.bars;
  const { root, keys } = harmony[bar % 4];
  const world = instrumentsByWorld[config.world];
  const { energy, mood } = config;
  const events: Event[] = [];
  const add = (instrument: Instrument, voice: Voice, at: number, pitch: number,
    length: number, velocity: number, pan?: number) => {
    if (config.layers[instrument]) events.push({ instrument, voice, at, pitch, length, velocity, pan });
  };
  const loose = mood === 'groovy' ? .025 : 0;
  const sustain = mood === 'intimate' || mood === 'relaxed' ? 1.05 : .83;
  for (const note of composition.motif[bar]) {
    const swing = note.at % .5 ? world.swing + loose : 0;
    add('lead', world.lead, note.at + swing, note.pitch, note.length * sustain,
      note.velocity * (.88 + .17 * energy), .08);
  }

  world.keysAt.forEach((at, chordHit) => keys.slice(0, energy < .42 ? 3 : 4).forEach((pitch, i) => {
    add('keys', world.keys, at + i * (config.world === 'intimate' ? .034 : .009), pitch,
      config.world === 'intimate' ? 1.9 : config.world === 'rnb' ? .72 : .37,
      (.43 - chordHit * .032) * (.78 + energy * .22), (i - 1.5) * .27);
  }));

  const bassAt = config.world === 'intimate' ? [0, 2.5] :
    config.world === 'rnb' ? [0, .75, 1.75, 2.5, 3.25] : [0, .5, 1, 1.5, 2, 2.5, 3, 3.5];
  bassAt.forEach((at, i) => {
    const pitch = config.world === 'rnb' && i === 4 ? root + 12 : root;
    add('bass', world.bass, at + (at % .5 ? world.swing : 0), pitch,
      config.world === 'intimate' ? 1.14 : config.world === 'rnb' ? .42 : .26, i % 2 ? .44 : .65);
  });

  keys.slice(1, 4).forEach((pitch, i) => add('pad', 'air', .025, pitch + (config.world === 'club' ? 12 : 0),
    3.64, .38 + energy * .16, (i - 1) * .52));

  const kicks = config.world === 'intimate' ? [0, 2.5] :
    config.world === 'rnb' ? [0, .75, 2.25, 3.25] : [0, 1, 2, 3];
  kicks.forEach((at, i) => add('drums', 'kick', at, 36, .3,
    (config.world === 'intimate' ? .34 : .76) * (i % 2 ? .75 : 1)));
  const backbeat = config.world === 'intimate' ? [3] : [1 + world.swing, 3 + world.swing];
  backbeat.forEach(at => add('drums', 'snare', at, 38, .18, config.world === 'intimate' ? .25 : .65, -.09));
  const hats = config.world === 'intimate' ? [1.5, 3.5] :
    config.world === 'rnb' && energy > .45 ? [.5, 1.5, 2.58, 3.5, 3.82] : [.5, 1.5, 2.5, 3.5];
  hats.forEach((at, i) => add('drums', 'hat', at, 42, config.world === 'club' ? .18 : .08,
    (i % 2 ? .57 : .4) * (config.world === 'intimate' ? .46 : 1), i % 2 ? .28 : -.26));
  return events.sort((a, b) => a.at - b.at);
}

export function secondsPerBeat(config: MusicConfig) {
  return 60 / worldInfo[config.world].bpm;
}
