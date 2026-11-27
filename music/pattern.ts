export type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square';
export type Drum = 'bd' | 'sd' | 'hh';
type Voice = { wave: Wave; gain: number; attack: number; release: number; lpf: number };
export type PatternEvent = Voice & { at: number; length: number; pitch: number | Drum };
export type Pattern = { secondsPerCycle: number; cycles: PatternEvent[][] };
type Step = string | { steps: Step[]; together: boolean };

const number = '(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)';
const comment = /"[^"\r\n]*"|\/\/[^\r\n]*/g;
const waves = new Set(['sine', 'triangle', 'sawtooth', 'square']);
const drums = new Set(['bd', 'sd', 'hh']);
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;

function sequence(input: string) {
  const tokens = input.match(/[^\s<>,[\]]+|[<>,[\]]/g) ?? [];
  let pos = 0;
  function bracket(close: string | undefined, depth: number): Step {
    if (depth > 4) throw new Error('Patterns can nest up to four groups.');
    const steps: Step[] = [];
    let together = false;
    while (pos < tokens.length && tokens[pos] !== close) {
      const token = tokens[pos++];
      if (token === '[') steps.push(bracket(']', depth + 1));
      else if (token === ',' && close === ']' && steps.length && tokens[pos] && ![']', ','].includes(tokens[pos])) together = true;
      else if ('<>,]'.includes(token)) throw new Error('Check the brackets and commas in the pattern.');
      else steps.push(token);
    }
    if (!steps.length || (close && tokens[pos++] !== close)) throw new Error('Check for an empty or unclosed pattern group.');
    return { steps, together };
  }
  if (tokens[0] !== '<') return [bracket(undefined, 0)];
  pos++;
  const outer = bracket('>', 0);
  if (pos !== tokens.length || typeof outer === 'string') throw new Error('Use one outer cycle group per track.');
  return outer.steps;
}

function note(token: string) {
  const match = /^([a-g])([#b]?)([0-8])$/i.exec(token);
  if (!match) throw new Error('Unsupported note "' + token + '". Try c4, f#4, or bb3.');
  const offsets: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  return (Number(match[3]) + 1) * 12 + offsets[match[1].toLowerCase()] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}

export function compilePattern(source: string): Pattern {
  if (source.length > 12_000) throw new Error('Keep the pattern under 12,000 characters.');
  let code = source.replace(comment, match => match.startsWith('//') ? '' : match).trim();
  const tempo = new RegExp('^setcps\\(\\s*(' + number + ')\\s*(/\\s*60\\s*/\\s*4)?\\s*\\)\\s*;?\\s*').exec(code);
  const bpm = tempo ? Number(tempo[1]) * (tempo[2] ? 1 : 240) : 100;
  if (bpm < 40 || bpm > 240) throw new Error('Tempo must be between 40 and 240 BPM.');
  if (tempo) code = code.slice(tempo[0].length);
  const tracks = code.split(/\$:/).map(text => text.trim()).filter(Boolean);
  if (!tracks.length || tracks.length > 8) throw new Error('Write between one and eight pattern tracks.');
  const parsed = tracks.map(track => {
    const line = /^(note|s|sound)\(\s*"([^"\r\n]+)"\s*\)/.exec(track);
    if (!line) {
      if (/^(?:const|let|var|function|if)\b/.test(track)) {
        throw new Error('JavaScript declarations and control flow need the full Strudel runtime. Choose Open in Strudel.');
      }
      throw new Error('Offline tracks start with note("…") or s("…"). Choose Open in Strudel to run a full Strudel program.');
    }
    const pitched = line[1] === 'note';
    const voice: Voice = { wave: 'triangle', gain: .22, attack: .012, release: .13, lpf: 12_000 };
    const limits = { gain: [0, 1], attack: [0, .5], release: [0, 1.5], lpf: [40, 16_000] };
    const settings = /^(?:\s*\.\s*(s|sound|gain|attack|release|lpf)\(\s*("[a-z]+"|[0-9.]+)\s*\))/;
    let rest = track.slice(line[0].length).trim().replace(/;$/, '').trim();
    while (rest) {
      const setting = settings.exec(rest);
      if (!setting) throw new Error('Unsupported setting near ' + rest.slice(0, 36) + '.');
      const [, name, value] = setting;
      if (!pitched && name !== 'gain') throw new Error('Drum tracks support gain. Use note() for synth settings.');
      if (name === 's' || name === 'sound') {
        const wave = value.slice(1, -1);
        if (!waves.has(wave)) throw new Error('Choose sine, triangle, square, or sawtooth.');
        voice.wave = wave as Wave;
      } else {
        const key = name as keyof typeof limits;
        const [min, max] = limits[key];
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount < min || amount > max) throw new Error(key + ' must be between ' + min + ' and ' + max + '.');
        voice[key] = amount;
      }
      rest = rest.slice(setting[0].length).trim();
    }
    return { groups: sequence(line[2]), pitched, voice };
  });
  const length = parsed.reduce((total, { groups }) => total * groups.length / gcd(total, groups.length), 1);
  if (length > 16) throw new Error('The combined loop can span up to sixteen cycles.');
  let count = 0;
  const cycles = Array.from({ length }, (_, cycle) => {
    const events: PatternEvent[] = [];
    for (const { groups, pitched, voice } of parsed) {
      function expand(step: Step, at: number, length: number) {
        if (typeof step !== 'string') {
          const span = step.together ? length : length / step.steps.length;
          step.steps.forEach((child, index) => expand(child, at + (step.together ? 0 : index * span), span));
        } else if (step !== '~') {
          if (++count > 1024 || length < 1 / 128) throw new Error('The pattern contains too many events or steps.');
          if (!pitched && !drums.has(step)) throw new Error('Available drums are bd, sd, and hh.');
          events.push({ ...voice, at, length, pitch: pitched ? note(step) : step as Drum });
        }
      }
      expand(groups[cycle % groups.length], 0, 1);
    }
    return events.sort((a, b) => a.at - b.at);
  });
  if (!count) throw new Error('Add at least one note or drum hit.');
  return { secondsPerCycle: 240 / bpm, cycles };
}
