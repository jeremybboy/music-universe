import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { composition } from '../music/composition.ts';
import { Transport } from '../music/transport.ts';
import { describePatch, instrumentLabels, instruments, moods, parseIntent, resolvePatch, worldInfo, worlds,
  type MusicConfigPatch } from '../music/state.ts';
import { mountField } from '../visualization/field.ts';
import './style.css';

const transport = new Transport();

function Glyph({ type }: { type: 'mark' | 'play' | 'pause' | 'arrow' | 'sound' | 'mute' | 'loop' }) {
  const symbols: Record<typeof type, ReactNode> = {
    mark: <path d="M3 13v-2m4 5V8m5 13V3m5 14V7m4 7v-4" />,
    play: <path d="m9 5 12 7-12 7z" fill="currentColor" strokeLinejoin="round" />,
    pause: <path d="M9 5v14m6-14v14" strokeWidth="4" />,
    arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
    sound: <path d="M3 9v6h4l5 4V5L7 9H3Zm13-1a6 6 0 0 1 0 8m2-11a9 9 0 0 1 0 14" />,
    mute: <path d="M3 9v6h4l5 4V5L7 9H3Zm13 0 6 6m0-6-6 6" />,
    loop: <path d="M18 3l3 3-3 3M3 11V9a3 3 0 0 1 3-3h15M6 21l-3-3 3-3m15-2v2a3 3 0 0 1-3 3H3" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{symbols[type]}</svg>;
}

function Player() {
  const [state, setState] = useState(() => transport.snapshot());
  const [intentText, setIntentText] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [volume, setVolume] = useState(80);
  const [opening, setOpening] = useState(false);
  const field = useRef<HTMLCanvasElement>(null);
  const volumeBeforeMute = useRef(80);
  const drawing = useRef<ReturnType<typeof mountField> | null>(null);
  const { config, beat, playing, pending } = state;
  const target = pending?.config ?? config;
  const currentBar = Math.floor(beat / 4) % composition.bars + 1;
  const progress = (beat % (composition.bars * 4)) / (composition.bars * 4);

  useEffect(() => {
    drawing.current = mountField(field.current!, transport);
    return () => { drawing.current?.(); };
  }, []);

  useEffect(() => {
    drawing.current?.refresh?.();
  }, [playing, config]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setState(transport.snapshot()), 95);
    return () => clearInterval(timer);
  }, [playing]);

  function change(patch: MusicConfigPatch) {
    transport.change(resolvePatch(transport.desired, patch));
    setState(transport.snapshot());
  }

  async function toggle() {
    setOpening(true);
    await transport.toggle();
    setState(transport.snapshot());
    setOpening(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = parseIntent(intentText, transport.desired);
    if (result.ok) {
      change(result.patch);
      setFeedback({ text: describePatch(result.patch), error: false });
      setIntentText('');
    } else {
      setFeedback({ text: result.message, error: true });
    }
  }

  function setLevel(level: number) {
    if (level > 0) volumeBeforeMute.current = level;
    setVolume(level);
    transport.setVolume(level / 100);
  }

  const pendingBar = pending ? pending.bar % composition.bars + 1 : null;

  return (
    <main className="app" data-world={config.world}>
      <header className="header">
        <a href="./" className="brand" aria-label="Music Universe home"><span><Glyph type="mark" /></span> Music Universe</a>
        <span className="header-context">Song explorer</span>
      </header>

      <div className="content">
        <section className="song" aria-labelledby="song-title">
          <div className="cover" role="img" aria-label="Abstract artwork with overlapping violet and amber light trails">
            <div className="cover-disc"></div>
            <div className="cover-arc"></div>
            <div className="cover-light"></div>
            <div className="cover-orbit"></div>
          </div>
          <h1 id="song-title">{composition.title}</h1>
          <p>One song, three ways to hear it.</p>
          <div className="song-meta"><Glyph type="loop" /> {composition.bars} bars <span>·</span> {composition.key}</div>
        </section>

        <section className="explore" aria-labelledby="world-title">
          <h2 id="world-title">Explore this song’s worlds</h2>
          <div className="worlds" role="group" aria-label="Musical world">
            {worlds.map(world => (
              <button type="button" key={world} className={'world world-' + world} data-active={config.world === world}
                data-queued={pending !== null && target.world === world && config.world !== world}
                aria-pressed={target.world === world} onClick={() => { setFeedback(null); change({ world }); }}>
                <span className="material" aria-hidden="true"></span>
                <span className="world-top"><span>{worldInfo[world].bpm} BPM</span>
                  {config.world === world && <Glyph type="mark" />}
                  {pending && target.world === world && config.world !== world && <span className="world-queued">Queued</span>}
                </span>
                <span className="world-name">{worldInfo[world].label}</span>
                <span className="texture">{worldInfo[world].texture}</span>
              </button>
            ))}
          </div>

          <form className="intent" onSubmit={submit}>
            <label htmlFor="intent">Ask for a change <span>Offline controls</span></label>
            <div className="intent-entry">
              <span className="spark" aria-hidden="true">✧</span>
              <input id="intent" value={intentText} onChange={event => setIntentText(event.target.value)}
                placeholder="Make it more intimate and less percussive" maxLength={160}
                aria-describedby="intent-feedback" autoComplete="off" />
              <button type="submit" aria-label="Apply text request" disabled={!intentText.trim()}><Glyph type="arrow" /></button>
            </div>
            <p id="intent-feedback" className={feedback?.error ? 'intent-error' : ''} aria-live="polite">
              {feedback?.text ?? 'Try “switch to Club”, “energy 65%”, or “mute drums”.'}
            </p>
          </form>

          <div className="modifiers">
            <div>
              <h3>Mood</h3>
              <div className="moods" role="group" aria-label="Mood">
                {moods.map(mood => (
                  <button type="button" key={mood} aria-pressed={target.mood === mood}
                    onClick={() => { setFeedback(null); change({ mood }); }}>{mood}</button>
                ))}
              </div>
            </div>
            <div className="energy">
              <label htmlFor="energy">Energy <output htmlFor="energy">{Math.round(target.energy * 100)}%</output></label>
              <input type="range" id="energy" min="0" max="100" value={Math.round(target.energy * 100)}
                onChange={event => { setFeedback(null); change({ energy: Number(event.target.value) / 100 }); }} />
            </div>
          </div>
          <h3 className="instrument-title">Instrumentation</h3>
          <div className="layers" role="group" aria-label="Instrumentation">
            {instruments.map(layer => (
              <button type="button" key={layer} aria-pressed={target.layers[layer]} onClick={() => {
                setFeedback(null);
                change({ layers: { [layer]: !transport.desired.layers[layer] } });
              }}><span aria-hidden="true"></span>{instrumentLabels[layer]}</button>
            ))}
          </div>
        </section>
      </div>

      <section className="stage" aria-label="Audio visualizer">
        <div className="stage-wash"></div>
        <canvas ref={field} aria-hidden="true" />
        <p className="signal-label"><span data-live={playing}></span>{playing ? 'Live signal' : 'Audio visualizer'}</p>
      </section>

      <footer className="transport">
        <div className="timeline" role="progressbar" aria-label="Position in the eight bar loop" aria-valuemin={0}
          aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-valuetext={'Bar ' + currentBar + ' of 8'}>
          {Array.from({ length: 8 }, (_, index) => <span key={index} style={{
            '--bar-fill': Math.min(100, Math.max(0, (progress * 8 - index) * 100)) + '%',
          } as React.CSSProperties}></span>)}
        </div>
        <div className="transport-row">
          <div className="now">
            <div className="now-main"><span className="now-dot"></span>{worldInfo[config.world].label}<span> · </span>{worldInfo[config.world].bpm} BPM</div>
            <div className="status" role="status">
              {state.error ?? (pending ? 'Scheduled for bar ' + pendingBar : playing ?
                (state.applied ? 'Applied · Playing' : 'Playing') : opening ? 'Preparing audio…' : 'Ready to play')}
            </div>
          </div>
          <button type="button" className="play" aria-label={playing ? 'Pause' : 'Play'} disabled={opening} onClick={toggle}>
            <Glyph type={playing ? 'pause' : 'play'} />
          </button>
          <div className="right-transport">
            <span className="bar-counter">Bar {currentBar} / 8</span>
            <button type="button" className="icon-button" aria-label={volume > 0 ? 'Mute output' : 'Unmute output'}
              onClick={() => setLevel(volume > 0 ? 0 : volumeBeforeMute.current)}>
              <Glyph type={volume > 0 ? 'sound' : 'mute'} />
            </button>
            <input aria-label="Volume" type="range" min="0" max="100" value={volume}
              onChange={event => setLevel(Number(event.target.value))} />
          </div>
        </div>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Player />);
