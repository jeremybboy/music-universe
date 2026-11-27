import { Synth } from './audio.ts';
import type { Pattern, PatternEvent } from './pattern.ts';
import { preset } from './state.ts';
import type { Universe } from './universe/model.ts';

export class PatternPlayer {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private volume = .8;

  async play(pattern: Pattern, song: Universe) {
    this.stop();
    const generation = this.generation;
    const context = this.context ??= new AudioContext();
    await context.resume();
    if (generation !== this.generation) return false;
    if (context.state !== 'running') throw new Error('The audio output could not start.');
    const output = this.output = context.createGain();
    output.gain.value = this.volume;
    const limiter = this.limiter = context.createDynamicsCompressor();
    output.connect(limiter).connect(context.destination);
    const synth = new Synth(context);
    const config = preset(song);
    const sound = (event: PatternEvent, time: number) => {
      const duration = Math.max(.016, event.length * pattern.secondsPerCycle * .75);
      if (typeof event.pitch !== 'number') {
        const voice = { bd: 'kick', sd: 'snare', hh: 'hat' } as const;
        synth.schedule({ voice: voice[event.pitch], instrument: 'drums', at: 0, length: duration,
          velocity: event.gain, pitch: 0 }, config, time, 1, output);
        return;
      }
      const oscillator = context.createOscillator();
      oscillator.type = event.wave;
      oscillator.frequency.value = 440 * 2 ** ((event.pitch - 69) / 12);
      const filter = context.createBiquadFilter();
      filter.frequency.value = event.lpf;
      const envelope = context.createGain();
      const gain = envelope.gain;
      gain.setValueAtTime(.0001, time);
      gain.linearRampToValueAtTime(event.gain, time + Math.min(event.attack || .001, duration));
      gain.setValueAtTime(event.gain, time + duration);
      gain.linearRampToValueAtTime(0, time + duration + event.release + .002);
      oscillator.connect(filter).connect(envelope).connect(output);
      oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); envelope.disconnect(); };
      oscillator.start(time);
      oscillator.stop(time + duration + event.release + .003);
    };

    let cycle = 0;
    let index = 0;
    let start = context.currentTime + .04;
    const tick = () => {
      const now = context.currentTime;
      if (start + pattern.secondsPerCycle < now) {
        const skipped = Math.floor((now - start) / pattern.secondsPerCycle);
        start += skipped * pattern.secondsPerCycle;
        cycle += skipped;
        index = 0;
      }
      while (start < now + .10) {
        const events = pattern.cycles[cycle % pattern.cycles.length];
        const event = events[index];
        if (event) {
          const time = start + event.at * pattern.secondsPerCycle;
          if (time >= now + .10) return;
          if (time > now) sound(event, time);
          index++;
        } else {
          start += pattern.secondsPerCycle;
          cycle++;
          index = 0;
        }
      }
    };
    tick();
    this.timer = setInterval(tick, 25);
    return true;
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.output && this.context) this.output.gain.setTargetAtTime(volume, this.context.currentTime, .025);
  }

  stop() {
    this.generation++;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.output && this.context) {
      const output = this.output;
      const now = this.context.currentTime;
      output.gain.setTargetAtTime(0, now, .003);
      const limiter = this.limiter;
      setTimeout(() => { output.disconnect(); limiter?.disconnect(); }, 24);
    }
    this.output = null;
    this.limiter = null;
  }
}
