import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beatsPerBar } from '../music/timing.ts';
import { canTransition, expressionFor, readUniverse } from '../music/universe/model.ts';
import { maxPackageBytes } from '../music/universe/zip.ts';
import afterimageArchive from '../songs/Afterimage.muv?url&inline';
import { Discover } from './Discover.tsx';
import { SongAnalysis } from './SongAnalysis.tsx';
import { StrudelPlayer } from './StrudelPlayer.tsx';
import { analysisAction, hasLocalAnalyst, stopTrackAudio } from './track-analysis.ts';
import { compilePattern } from '../music/pattern.ts';
import { PatternPlayer } from '../music/pattern-player.ts';
import starterPattern from '../music/renditions/afterimage-intimate.strudel?raw';
import { AnalysisSession } from '../music/analysis-report.ts';
import { Transport } from '../music/transport.ts';
import { describePatch, instrumentLabels, parseIntent, type MusicConfigPatch } from '../music/state.ts';
import { mountField } from '../visualization/field.ts';
import './style.css';

const starterBytes = Uint8Array.from(atob(afterimageArchive.split(',')[1]), character => character.charCodeAt(0));
const starterSong = readUniverse(starterBytes);
const transport = new Transport(starterSong);
const patternPlayer = new PatternPlayer();

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

const views = [
  ['listen', 'Listen'], ['discover', 'Discover'], ['analysis', 'Song Analysis'], ['strudel', 'Strudel Player'],
] as const;
type View = typeof views[number][0];

function Player() {
  const [state, setState] = useState(() => transport.snapshot());
  const [song, setSong] = useState(starterSong);
  const [view, setView] = useState<View>('listen');
  const [analysisSession] = useState(() => new AnalysisSession());
  const [strudelHandoff, setStrudelHandoff] = useState(false);
  const [patternSource, setPatternSource] = useState(starterPattern);
  const [patternRunning, setPatternRunning] = useState(false);
  const [patternError, setPatternError] = useState('');
  const [loadingSong, setLoadingSong] = useState(false);
  const [fileError, setFileError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [intentText, setIntentText] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [volume, setVolume] = useState(80);
  const [opening, setOpening] = useState(false);
  const field = useRef<HTMLCanvasElement>(null);
  const volumeBeforeMute = useRef(80);
  const drawing = useRef<ReturnType<typeof mountField> | null>(null);
  const { config, beat, playing, pending } = state;
  const target = pending?.config ?? config;
  const { identity, expressions, roles, possibilities } = song;
  const active = expressionFor(song, config.world);
  const currentBar = Math.floor(beat / beatsPerBar) % identity.bars + 1;
  const totalBeats = identity.bars * beatsPerBar;
  const progress = (beat % totalBeats) / totalBeats;

  function selectSong(next: typeof song) {
    transport.replaceSong(next);
    setSong(next);
    document.title = 'Music Universe | ' + next.identity.title;
    setState(transport.snapshot());
    setFeedback(null);
    setIntentText('');
    setFileError('');
  }

  async function openSong(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setLoadingSong(true);
    setFileError('');
    try {
      if (file.size > maxPackageBytes) throw new Error('Package exceeds the 512 KiB limit.');
      selectSong(readUniverse(new Uint8Array(await file.arrayBuffer())));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'The song could not be opened.');
    } finally {
      setLoadingSong(false);
    }
  }

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
    try {
      transport.change(patch);
      setState(transport.snapshot());
      return true;
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : 'This change is unavailable.', error: true });
      return false;
    }
  }

  function stopPattern() {
    patternPlayer.stop();
    setPatternRunning(false);
  }

  function claimAudio() {
    if (opening || strudelHandoff) return false;
    stopPattern();
    transport.pause();
    setState(transport.snapshot());
    return true;
  }

  function selectView(next: View) {
    if (next !== 'strudel') stopPattern();
    if (next !== 'analysis') void stopTrackAudio();
    setView(next);
  }

  async function playPattern() {
    if (opening || loadingSong || strudelHandoff) return;
    setPatternError('');
    try {
      const pattern = compilePattern(patternSource);
      if (claimAudio() && await patternPlayer.play(pattern, song)) setPatternRunning(true);
    } catch (error) {
      setPatternError(error instanceof Error ? error.message : 'The pattern could not start.');
    }
  }

  function pauseForExternal(href: string) {
    if (opening || loadingSong || strudelHandoff) return;
    claimAudio();
    setStrudelHandoff(true);
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  async function toggle() {
    if (strudelHandoff) return;
    setOpening(true);
    stopPattern();
    document.querySelector<HTMLAudioElement>('audio[aria-label="Original recording"]')?.pause();
    if (hasLocalAnalyst && view === 'analysis') await stopTrackAudio();
    await transport.toggle();
    setState(transport.snapshot());
    setOpening(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = parseIntent(song, intentText, transport.desired, transport.snapshot().transitionFrom);
    if (result.ok) {
      if (change(result.patch)) {
        setFeedback({ text: describePatch(song, result.patch), error: false });
        setIntentText('');
      }
    } else {
      setFeedback({ text: result.message, error: true });
    }
  }

  function setLevel(level: number) {
    if (level > 0) volumeBeforeMute.current = level;
    setVolume(level);
    transport.setVolume(level / 100);
    patternPlayer.setVolume(level / 100);
    if (hasLocalAnalyst) void analysisAction('volume', { level: level / 100 }).catch(() => {});
  }

  const pendingBar = pending ? pending.bar % identity.bars + 1 : null;

  return (
    <main className="app" data-world={config.world} data-view={view}>
      <header className="header">
        <a href="./index.html" className="brand" aria-label="Music Universe home"><span><Glyph type="mark" /></span> Music Universe</a>
        <nav className="player-nav" aria-label="Player view">
          {views.map(([id, label]) =>
            <button key={id} type="button" aria-pressed={view === id} onClick={() => selectView(id)}>{label}</button>)}
        </nav>
        <div className="song-files">
          {song !== starterSong && <button type="button" disabled={loadingSong || opening}
            onClick={() => selectSong(starterSong)}>Afterimage</button>}
          <button type="button" disabled={loadingSong || opening} onClick={() => fileInput.current?.click()}>Open .muv</button>
          <input ref={fileInput} type="file" accept=".muv" hidden onChange={openSong} />
        </div>
      </header>
      {fileError && <p className="file-error" role="alert">Couldn’t open song. {fileError}</p>}

      <div className="content" hidden={view !== 'listen'}>
        <section className="song" aria-labelledby="song-title">
          <div className="cover" role="img" aria-label="Abstract artwork with overlapping violet and amber light trails">
            <div className="cover-disc"></div>
            <div className="cover-arc"></div>
            <div className="cover-light"></div>
            <div className="cover-orbit"></div>
          </div>
          <h1 id="song-title">{identity.title}</h1>
          <p>{song === starterSong ? 'One song, three ways to hear it.' : 'Artist-authored song package.'}</p>
          <div className="song-meta"><Glyph type="loop" /> {identity.bars} {identity.bars === 1 ? 'bar' : 'bars'}{identity.key && <><span>·</span> {identity.key}</>}</div>
        </section>

        <section className="explore" aria-labelledby="world-title">
          <h2 id="world-title">Explore this song’s worlds</h2>
          <div className="worlds" role="group" aria-label="Musical world">
            {expressions.map(({ id: world, label, bpm, texture }) => (
              <button type="button" key={world} className={'world world-' + world} data-active={config.world === world}
                data-queued={pending !== null && target.world === world && config.world !== world}
                aria-pressed={target.world === world}
                disabled={!canTransition(song, state.transitionFrom, world)} onClick={() => { setFeedback(null); change({ world }); }}>
                <span className="material" aria-hidden="true"></span>
                <span className="world-top"><span>{bpm} BPM</span>
                  {config.world === world && <Glyph type="mark" />}
                  {pending && target.world === world && config.world !== world && <span className="world-queued">Queued</span>}
                </span>
                <span className="world-name">{label}</span>
                <span className="texture">{texture}</span>
              </button>
            ))}
          </div>

          <form className="intent" onSubmit={submit}>
            <label htmlFor="intent">Ask for a change <span>Offline controls</span></label>
            <div className="intent-entry">
              <span className="spark" aria-hidden="true">✧</span>
              <input id="intent" value={intentText} onChange={event => setIntentText(event.target.value)}
                placeholder={song === starterSong ? 'Make it more intimate and less percussive' : 'Ask for an available change'}
                maxLength={160}
                aria-describedby="intent-feedback" autoComplete="off" />
              <button type="submit" aria-label="Apply text request" disabled={!intentText.trim()}><Glyph type="arrow" /></button>
            </div>
            <p id="intent-feedback" className={feedback?.error ? 'intent-error' : ''} aria-live="polite">
              {feedback?.text ?? (song === starterSong ?
                'Try “switch to Club”, “energy 65%”, or “mute drums”.' : 'Available controls are shown below.')}
            </p>
          </form>

          <div className="modifiers">
            <div>
              <h3>Mood</h3>
              <div className="moods" role="group" aria-label="Mood">
                {possibilities.moods.map(mood => (
                  <button type="button" key={mood} aria-pressed={target.mood === mood}
                    disabled={!possibilities.transforms.includes('mood-articulation')}
                    onClick={() => { setFeedback(null); change({ mood }); }}>{mood}</button>
                ))}
              </div>
            </div>
            <div className="energy">
              <label htmlFor="energy">Energy <output htmlFor="energy">{Math.round(target.energy * 100)}%</output></label>
              <input type="range" id="energy" min="0" max="100" value={Math.round(target.energy * 100)}
                disabled={!possibilities.transforms.includes('energy-shaping')}
                onChange={event => { setFeedback(null); change({ energy: Number(event.target.value) / 100 }); }} />
            </div>
          </div>
          <h3 className="instrument-title">Instrumentation</h3>
          <div className="layers" role="group" aria-label="Instrumentation">
            {roles.map(layer => (
              <button type="button" key={layer} aria-pressed={target.layers[layer]}
                disabled={!possibilities.transforms.includes('layer-mix')} onClick={() => {
                setFeedback(null);
                change({ layers: { [layer]: !transport.desired.layers[layer] } });
              }}><span aria-hidden="true"></span>{instrumentLabels[layer]}</button>
            ))}
          </div>
        </section>
      </div>

      {view === 'discover' && <Discover song={song} state={state} currentBar={currentBar}
        selectWorld={world => { setFeedback(null); change({ world }); }} />}

      {view === 'analysis' && <SongAnalysis song={song} world={active.id} session={analysisSession} claimAudio={claimAudio} />}
      {view === 'strudel' && <StrudelPlayer songTitle={identity.title} expression={active.label} world={active.id}
        bundledAfterimage={song === starterSong} disabled={opening || loadingSong} handoff={strudelHandoff}
        pauseForExternal={pauseForExternal} source={patternSource} setSource={setPatternSource}
        running={patternRunning} error={patternError} playPattern={playPattern} stopPattern={stopPattern} />}

      <section className="stage" aria-label="Audio visualizer">
        <div className="stage-wash"></div>
        <canvas ref={field} aria-hidden="true" />
        <p className="signal-label"><span data-live={playing}></span>{playing ? 'Live signal' : 'Audio visualizer'}</p>
      </section>

      <footer className="transport">
        {strudelHandoff && <div className="strudel-handoff">
          <p>Stop playback in the Strudel tab before resuming Music Universe.</p>
          <button type="button" className="destination-action" onClick={() => setStrudelHandoff(false)}>I stopped Strudel</button>
        </div>}
        <div className="timeline" role="progressbar" aria-label="Position in the song loop" aria-valuemin={0}
          style={{ gridTemplateColumns: 'repeat(' + identity.bars + ', minmax(0, 1fr))' }}
          aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
          aria-valuetext={'Bar ' + currentBar + ' of ' + identity.bars}>
          {Array.from({ length: identity.bars }, (_, index) => <span key={index} style={{
            '--bar-fill': Math.min(100, Math.max(0, (progress * identity.bars - index) * 100)) + '%',
          } as React.CSSProperties}></span>)}
        </div>
        <div className="transport-row">
          <div className="now">
            <div className="now-main"><span className="now-dot"></span>{active.label}<span> · </span>{active.bpm} BPM</div>
            <div className="status" role="status">
              {state.error ?? (pending ? 'Scheduled for bar ' + pendingBar : playing ?
                (state.applied ? 'Applied · Playing' : 'Playing') : opening ? 'Preparing audio…' : 'Ready to play')}
            </div>
          </div>
          <button type="button" className="play" aria-label={playing ? 'Pause' : 'Play'} disabled={opening || loadingSong || strudelHandoff} onClick={toggle}>
            <Glyph type={playing ? 'pause' : 'play'} />
          </button>
          <div className="right-transport">
            <span className="bar-counter">Bar {currentBar} / {identity.bars}</span>
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
