import { Synth } from './audio.ts';
import { eventsForBar, secondsPerBeat } from './composition.ts';
import { preset, resolvePatch, sameConfig, type MusicConfig, type MusicConfigPatch } from './state.ts';
import type { Universe } from './universe/model.ts';
import type { World } from './vocabulary.ts';
import { beatAt, beatsPerBar, nextBoundaryBar, type ClockAnchor } from './timing.ts';

type Transition = { config: MusicConfig; bar: number; time: number };
export type Playback = {
  playing: boolean;
  config: MusicConfig;
  transitionFrom: World;
  beat: number;
  pending: Transition | null;
  applied: number;
  error: string | null;
};

const lookahead = .105;
const crossfade = .076;

export class Transport {
  analyser: AnalyserNode | null = null;
  private context: AudioContext | null = null;
  private synth: Synth | null = null;
  private output: GainNode | null = null;
  private buses = new Set<GainNode>();
  private bus: GainNode | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private opening: Promise<void> | null = null;
  private song: Universe;
  private clock: ClockAnchor;
  private active: MusicConfig;
  private scheduled: MusicConfig;
  private queued: Transition | null = null;
  private armed: Transition | null = null;
  private nextBar = 0;
  private nextTime = 0;
  private position = 0;
  private applied = 0;
  private volume = .8;
  private error: string | null = null;

  constructor(song: Universe) {
    this.song = song;
    this.active = preset(song);
    this.scheduled = this.active;
    this.clock = { time: 0, beat: 0, secondsPerBeat: secondsPerBeat(song, this.active) };
  }

  replaceSong(song: Universe) {
    const config = preset(song);
    this.pause();
    this.song = song;
    this.active = config;
    this.scheduled = config;
    this.position = 0;
    this.applied = 0;
    this.error = null;
  }

  get desired(): MusicConfig {
    this.activate();
    return this.queued?.config ?? this.armed?.config ?? this.active;
  }

  get audioTime() {
    return this.context?.currentTime ?? 0;
  }

  snapshot(): Playback {
    this.activate();
    const playing = this.interval !== null;
    return {
      config: this.active, playing, applied: this.applied, error: this.error,
      transitionFrom: this.armed?.config.world ?? this.active.world,
      beat: playing ? beatAt(this.clock, this.audioTime) : this.position,
      pending: this.queued ?? this.armed,
    };
  }

  change(patch: MusicConfigPatch) {
    const current = this.snapshot();
    const desired = this.queued?.config ?? this.armed?.config ?? this.active;
    const config = resolvePatch(this.song, desired, patch, current.transitionFrom);
    if (!current.playing) {
      this.active = config;
      this.applied++;
      return;
    }
    if (sameConfig(config, this.armed?.config ?? current.config)) {
      this.queued = null;
      return;
    }
    const bar = nextBoundaryBar(current.beat, this.nextBar);
    const time = this.nextTime + (bar - this.nextBar) * beatsPerBar * secondsPerBeat(this.song, this.scheduled);
    this.queued = { config, bar, time };
  }

  async toggle() {
    if (this.interval !== null) {
      this.pause();
      return;
    }
    if (this.opening) return this.opening;
    this.opening = this.start();
    try {
      await this.opening;
    } finally {
      this.opening = null;
    }
  }

  private async start() {
    this.error = null;
    try {
      if (!this.context) this.createGraph();
      const context = this.context!;
      await context.resume();
      if (context.state !== 'running') throw new Error('Audio context is not running.');
      const downbeat = context.currentTime + .055;
      const bar = Math.floor(this.position / beatsPerBar);
      const seconds = secondsPerBeat(this.song, this.active);
      this.clock = { time: downbeat, beat: this.position, secondsPerBeat: seconds };
      this.scheduled = this.active;
      this.nextBar = bar;
      this.nextTime = downbeat - (this.position % beatsPerBar) * seconds;
      this.bus = this.createBus(downbeat, 1);
      this.interval = setInterval(() => this.tick(), 21);
      this.tick();
    } catch {
      this.pause();
      this.error = 'The browser could not start audio. Press Play to retry.';
    }
  }

  pause() {
    if (this.interval === null) return;
    const current = this.snapshot();
    clearInterval(this.interval);
    this.interval = null;
    this.position = current.beat;
    if (current.pending) {
      this.active = current.pending.config;
      this.applied++;
    }
    this.armed = null;
    this.queued = null;
    for (const bus of this.buses) this.fadeOut(bus, this.audioTime, .034);
    this.bus = null;
  }

  setVolume(volume: number) {
    this.volume = volume;
    this.output?.gain.setTargetAtTime(volume, this.audioTime, .025);
  }

  private createGraph() {
    const context = new AudioContext();
    this.context = context;
    this.synth = new Synth(context);
    this.output = context.createGain();
    this.output.gain.value = this.volume;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 10;
    limiter.ratio.value = 7;
    limiter.attack.value = .006;
    limiter.release.value = .12;
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = .62;
    this.output.connect(limiter).connect(this.analyser).connect(context.destination);
  }

  private createBus(time: number, target: number) {
    const bus = this.context!.createGain();
    bus.gain.setValueAtTime(0, time);
    bus.gain.linearRampToValueAtTime(target, time + (target === 1 ? .009 : crossfade));
    bus.connect(this.output!);
    this.buses.add(bus);
    return bus;
  }

  private fadeOut(bus: GainNode, time: number, duration: number) {
    bus.gain.cancelAndHoldAtTime(time);
    bus.gain.linearRampToValueAtTime(0, time + duration);
    setTimeout(() => {
      bus.disconnect();
      this.buses.delete(bus);
    }, Math.max(0, time + duration - this.audioTime) * 1000 + 45);
  }

  private activate() {
    if (this.armed && this.audioTime >= this.armed.time) {
      this.active = this.armed.config;
      this.clock = {
        time: this.armed.time, beat: this.armed.bar * beatsPerBar,
        secondsPerBeat: secondsPerBeat(this.song, this.active),
      };
      this.armed = null;
      this.applied++;
    }
  }

  private tick() {
    const now = this.audioTime;
    this.activate();
    while (this.nextTime < now + lookahead) {
      const bar = this.nextBar;
      if (this.queued?.bar === bar) {
        const time = Math.max(now, this.nextTime);
        this.fadeOut(this.bus!, time, crossfade);
        this.bus = this.createBus(time, .999);
        this.armed = this.queued;
        this.queued = null;
        this.scheduled = this.armed.config;
        this.activate();
      }
      const seconds = secondsPerBeat(this.song, this.scheduled);
      for (const note of eventsForBar(this.song, bar, this.scheduled)) {
        const time = this.nextTime + note.at * seconds;
        if (time >= now + .002) this.synth!.schedule(note, this.scheduled, time, seconds, this.bus!);
      }
      this.nextTime += beatsPerBar * seconds;
      this.nextBar++;
    }
  }
}
