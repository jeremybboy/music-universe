import type { MusicConfig } from './state.ts';
import { expressionFor, type Event, type Universe } from './universe/model.ts';

export type { Event } from './universe/model.ts';

export function eventsForBar(song: Universe, absoluteBar: number, config: MusicConfig): Event[] {
  const expression = expressionFor(song, config.world);
  const bar = absoluteBar % song.identity.bars;
  const events: Event[] = [];
  for (const note of expression.bars[bar]) {
    if (!config.layers[note.instrument]) continue;
    const gate = note.energy_gate;
    if (gate?.op === 'at_least' && config.energy < gate.value ||
        gate?.op === 'above' && config.energy <= gate.value ||
        gate?.op === 'at_most' && config.energy > gate.value) continue;
    const at = config.mood === 'groovy' ? note.groovy_at ?? note.at : note.at;
    const length = config.mood === 'groovy' || config.mood === 'energetic' ?
      note.short_length ?? note.length : note.length;
    events.push({
      instrument: note.instrument, voice: note.voice, at, pitch: note.pitch, length,
      velocity: note.velocity + (note.energy_velocity ?? 0) * config.energy, pan: note.pan,
    });
  }
  return events.sort((a, b) => a.at - b.at);
}

export function secondsPerBeat(song: Universe, config: MusicConfig) {
  return 60 / expressionFor(song, config.world).bpm;
}
