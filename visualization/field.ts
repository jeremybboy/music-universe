import { instruments, type World } from '../music/state.ts';
import type { Transport } from '../music/transport.ts';

const palette: Record<World, [number, number, number]> = {
  intimate: [260, 324, 32],
  rnb: [272, 309, 23],
  club: [242, 285, 315],
};

export function mountField(canvas: HTMLCanvasElement, transport: Transport) {
  const context = canvas.getContext('2d');
  if (!context) return Object.assign(() => {}, { refresh: () => {} });
  const draw = context;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0;
  let height = 0;
  let wave = new Float32Array(0);
  let spectrum = new Uint8Array(0);
  let lastAnalyser: AnalyserNode | null = null;
  let hues = [...palette.intimate];
  let rms = 0, bass = 0, mids = 0, highs = 0, pulse = 0, previousBass = 0;
  let frame = 0;
  let last = 0;
  let phase = 0;
  let density = 15;

  function band(from: number, to: number, nyquist: number) {
    const scale = spectrum.length / nyquist;
    const start = Math.max(1, Math.floor(from * scale));
    const end = Math.min(spectrum.length, Math.ceil(to * scale));
    let power = 0;
    for (let i = start; i < end; i++) power += (spectrum[i] / 255) ** 2;
    return Math.sqrt(power / Math.max(1, end - start));
  }

  function paint(time: number, advance: boolean) {
    const state = transport.snapshot();
    const delta = last ? Math.min(.05, (time - last) / 1000) : .016;
    last = time;
    const analyser = transport.analyser;
    const motion = advance && state.playing && !reduced.matches;
    let level = 0, low = 0, middle = 0, high = 0;
    if (motion && analyser) {
      if (analyser !== lastAnalyser) {
        wave = new Float32Array(analyser.fftSize);
        spectrum = new Uint8Array(analyser.frequencyBinCount);
        lastAnalyser = analyser;
      }
      analyser.getFloatTimeDomainData(wave);
      analyser.getByteFrequencyData(spectrum);
      let energy = 0;
      for (const sample of wave) energy += sample * sample;
      level = Math.sqrt(energy / wave.length);
      const nyquist = analyser.context.sampleRate / 2;
      if (level > .001) {
        low = band(35, 155, nyquist);
        middle = band(155, 2100, nyquist);
        high = band(2100, 9000, nyquist);
      }
    }
    const blend = 1 - Math.exp(-delta * 8);
    rms += (level - rms) * blend;
    bass += (low - bass) * blend;
    mids += (middle - mids) * blend;
    highs += (high - highs) * blend;
    pulse = Math.max(pulse * Math.exp(-delta * 7), Math.min(1, Math.max(0, (low - previousBass) * 2.4)));
    previousBass += (low - previousBass) * (1 - Math.exp(-delta * 16));
    const activity = Math.min(1, rms * 8);
    const { world, layers, energy, mood } = state.config;
    const activeLayers = instruments.filter(layer => layers[layer]).length;
    density += (5 + activeLayers * 2.4 - density) * blend;
    const pace = mood === 'energetic' ? 1.35 : mood === 'groovy' ? 1.04 : .78;
    phase += delta * activity * pace * (.5 + energy);
    const target = palette[world];
    const colorBlend = motion ? 1 - Math.exp(-delta * 3) : 1;
    hues = hues.map((hue, index) => hue + (target[index] - hue) * colorBlend);

    draw.clearRect(0, 0, width, height);
    const gradient = draw.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, 'hsl(' + hues[0] + ' 85% 66% / .04)');
    gradient.addColorStop(.23, 'hsl(' + hues[0] + ' 100% 72%)');
    gradient.addColorStop(.49, 'hsl(' + hues[1] + ' 100% 74%)');
    gradient.addColorStop(.70, 'hsl(' + hues[2] + ' 100% 70%)');
    gradient.addColorStop(.88, 'hsl(' + hues[1] + ' 86% 68%)');
    gradient.addColorStop(1, 'hsl(' + hues[0] + ' 85% 66% / .08)');

    const count = Math.round(density);
    const midpoint = height * .55;
    const steps = Math.min(150, Math.ceil(width / 8));
    const shape = (x: number, row: number) => {
      const crest = Math.sin(x * 9.4 + .5 + phase + row * .092)
        + .41 * Math.sin(x * 19.3 - row * .14 - phase * 1.55 + .8);
      const secondary = Math.sin(x * 26 - phase * 2 + row * .16) * mids * .42;
      const shapeWidth = .38 + .62 * Math.sin(Math.PI * x);
      return midpoint + row * height * .017 +
        (crest + secondary) * height * (.095 + activity * .08 + bass * .055) * shapeWidth;
    };

    draw.lineCap = 'round';
    draw.strokeStyle = gradient;
    draw.fillStyle = gradient;
    for (let line = 0; line < count; line++) {
      const row = line - (count - 1) / 2;
      const center = 1 - Math.abs(row) / Math.max(1, count / 2);
      draw.beginPath();
      for (let step = 0; step <= steps; step++) {
        const x = step / steps;
        const y = shape(x, row);
        if (step === 0) draw.moveTo(x * width, y);
        else draw.lineTo(x * width, y);
      }
      if (line % 4 === 0 && activeLayers) {
        draw.globalAlpha = .06 + activity * .09;
        draw.lineWidth = 4;
        draw.stroke();
      }
      draw.globalAlpha = (.12 + center * .38 + activity * .32) * (activeLayers ? 1 : .4);
      draw.lineWidth = line % 4 === 0 ? 1.25 : .75;
      draw.stroke();
      if (line % 2 === 0) {
        draw.globalAlpha = .18 + center * .27 + highs * .38;
        for (let i = 2 + line % 4; i <= steps; i += 4) {
          const x = i / steps;
          const y = shape(x, row);
          const size = .7 + ((i * 31 + line * 19) % 23 === 0 ? pulse * 3 + 1 : .2);
          draw.fillRect(x * width, y, size, size);
        }
      }
    }
    if (motion && activity > .015) {
      for (let i = 0; i < 56; i++) {
        const x = ((i * 67) % 223 + 3) / 229;
        const energy = spectrum[2 + ((i * 49) % 180)] / 255;
        const y = shape(x, -4);
        draw.globalAlpha = energy * (.25 + pulse * .44);
        const height = energy * (16 + (i % 7) * 8) * (.5 + pulse);
        draw.fillRect(x * width, y - height, i % 5 === 0 ? 1.5 : .7, height);
      }
    }
    draw.globalAlpha = 1;
  }

  function animate(now: number) {
    frame = 0;
    paint(now, true);
    if (transport.snapshot().playing && !reduced.matches) frame = requestAnimationFrame(animate);
  }

  function refresh() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (width && height) paint(performance.now(), false);
    if (transport.snapshot().playing && !reduced.matches) frame = requestAnimationFrame(animate);
  }

  const resize = new ResizeObserver(([entry]) => {
    width = entry.contentRect.width;
    height = entry.contentRect.height;
    const scale = Math.min(2, devicePixelRatio);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    draw.setTransform(scale, 0, 0, scale, 0, 0);
    refresh();
  });
  resize.observe(canvas);
  reduced.addEventListener('change', refresh);

  return Object.assign(() => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    reduced.removeEventListener('change', refresh);
  }, { refresh });
}
