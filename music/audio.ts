import type { Event } from './composition.ts';
import type { Mood, MusicConfig } from './state.ts';

const tone = {
  felt:   { partials: [[1, .74], [2, .22], [3.01, .07], [5.02, .03]], cutoff: 2300, attack: .007, tail: .17, gain: .2, sustain: .19 },
  rhodes: { partials: [[1, .74], [2, .26], [4.01, .10], [6.01, .032]], cutoff: 3200, attack: .009, tail: .14, gain: .21, sustain: .32 },
  pluck:  { partials: [[1, .68], [2, .31], [3, .18], [4, .12], [7, .06]], cutoff: 3600, attack: .005, tail: .09, gain: .17, sustain: .21 },
  sub:    { partials: [[1, 1], [2, .13]], cutoff: 570, attack: .023, tail: .13, gain: .21, sustain: .65 },
  round:  { partials: [[1, .9], [2, .35], [3, .11]], cutoff: 1100, attack: .009, tail: .085, gain: .27, sustain: .58 },
  drive:  { partials: [[1, .8], [2, .38], [3, .2], [4, .13], [5, .09]], cutoff: 1300, attack: .008, tail: .058, gain: .23, sustain: .62 },
  air:    { partials: [[.998, .5], [1.002, .5], [2, .16], [3.003, .062]], cutoff: 2300, attack: .24, tail: .35, gain: .083, sustain: .8 },
};
const moodBrightness: Record<Mood, number> = { relaxed: .8, intimate: .64, groovy: 1, energetic: 1.32 };
const frequency = (note: number) => 440 * 2 ** ((note - 69) / 12);

export class Synth {
  private context: BaseAudioContext;
  private noise: AudioBuffer;

  constructor(context: BaseAudioContext) {
    this.context = context;
    this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * .55), context.sampleRate);
    const data = this.noise.getChannelData(0);
    let random = 7919;
    for (let i = 0; i < data.length; i++) {
      random = (Math.imul(1664525, random) + 1013904223) >>> 0;
      data[i] = random / 2147483648 - 1;
    }
  }

  schedule(event: Event, config: MusicConfig, time: number, secondsPerBeat: number, destination: AudioNode) {
    const context = this.context;
    const envelope = context.createGain();
    const pan = context.createStereoPanner();
    const filter = context.createBiquadFilter();
    pan.pan.value = event.pan ?? 0;
    filter.connect(envelope).connect(pan).connect(destination);
    const sources: AudioScheduledSourceNode[] = [];
    let end: number;

    if (event.voice === 'kick') {
      end = time + .25;
      const kick = context.createOscillator();
      kick.frequency.setValueAtTime(config.world === 'club' ? 148 : 104, time);
      kick.frequency.exponentialRampToValueAtTime(47, time + .08);
      kick.connect(filter);
      filter.frequency.value = 1100 + config.energy * 700;
      this.envelope(envelope.gain, time, time + .028, end, .53 * event.velocity, .003, .45);
      sources.push(kick);
    } else if (event.voice === 'snare' || event.voice === 'hat') {
      const hat = event.voice === 'hat';
      end = time + (hat ? Math.max(.035, event.length * secondsPerBeat) : .17);
      filter.type = hat ? 'highpass' : 'bandpass';
      filter.frequency.value = (hat ? 7100 : 2200) * moodBrightness[config.mood];
      filter.Q.value = hat ? .3 : .68;
      const noise = context.createBufferSource();
      noise.buffer = this.noise;
      noise.connect(filter);
      this.envelope(envelope.gain, time, time + (hat ? .012 : .034), end,
        (hat ? .15 : .3) * event.velocity * (.58 + config.energy * .48), .003, .36);
      sources.push(noise);
    } else {
      const profile = tone[event.voice];
      const hold = time + event.length * secondsPerBeat;
      end = hold + profile.tail;
      const brightness = moodBrightness[config.mood] * (.72 + config.energy * .61);
      filter.frequency.value = profile.cutoff * brightness;
      const groupGain = event.instrument === 'keys' ? .52 : event.instrument === 'pad' ?
        (config.world === 'club' ? .85 : .53) : 1;
      const attack = event.voice === 'air' ? profile.attack : profile.attack * (config.mood === 'intimate' ? 1.4 : 1);
      this.envelope(envelope.gain, time, hold, end, profile.gain * event.velocity * groupGain, attack, profile.sustain);
      this.partials(event.voice, event.pitch, filter, sources);
    }

    let remaining = sources.length;
    for (const source of sources) {
      source.onended = () => {
        source.disconnect();
        if (--remaining === 0) {
          filter.disconnect();
          envelope.disconnect();
          pan.disconnect();
        }
      };
      source.start(time);
      source.stop(end + .004);
    }
  }

  private partials(voice: keyof typeof tone, pitch: number, filter: AudioNode, sources: AudioScheduledSourceNode[]) {
    const base = frequency(pitch);
    for (const [ratio, mix] of tone[voice].partials) {
      const oscillator = this.context.createOscillator();
      oscillator.frequency.value = base * ratio;
      const amplitude = this.context.createGain();
      amplitude.gain.value = mix;
      oscillator.connect(amplitude).connect(filter);
      sources.push(oscillator);
    }
  }

  private envelope(gain: AudioParam, start: number, hold: number, end: number, peak: number, attack: number, sustain: number) {
    gain.setValueAtTime(.0001, start);
    gain.linearRampToValueAtTime(peak, Math.min(start + attack, hold - .002));
    gain.exponentialRampToValueAtTime(Math.max(.0001, peak * sustain), hold);
    gain.exponentialRampToValueAtTime(.0001, end);
  }
}
