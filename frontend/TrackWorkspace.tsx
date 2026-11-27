import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { readAnalysisReport, type AnalysisReport } from '../music/analysis-report.ts';
import { AnalysisEvidence } from './AnalysisEvidence.tsx';
import { analysisAction, hasLocalAnalyst, stopTrackAudio, type TrackStatus } from './track-analysis.ts';

const stems = [
  ['drums', 'Drums'], ['bass', 'Bass'], ['other', 'Accompaniment'], ['vocals', 'Vocals'],
] as const;

const drumParts = [
  ['kick', 'Kick'], ['snare', 'Snare'], ['hihat', 'Hi-hat'], ['percussion', 'Percussion remainder'],
] as const;

function clock(time: number) {
  return Math.floor(time / 60) + ':' + String(Math.floor(time % 60)).padStart(2, '0');
}

export function TrackWorkspace({ claimAudio }: { claimAudio: () => boolean }) {
  return hasLocalAnalyst ? <LocalTrack claimAudio={claimAudio} /> : <BrowserTrack claimAudio={claimAudio} />;
}

function BrowserTrack({ claimAudio }: { claimAudio: () => boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [href, setHref] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setHref(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!next) return;
    setError('');
    setFile(next);
  }

  return <section className="track-workspace" aria-labelledby="track-heading">
    <div className="destination-heading"><div><h2 id="track-heading">Analyze a recording</h2>
      <p>Run analysis and stem separation in the Mac app. Preview a local recording here.</p></div>
      <label className="destination-action track-file">Choose audio<input type="file" accept="audio/*,.flac,.ogg,.opus,.aiff"
        aria-label="Choose audio" onChange={choose} /></label></div>
    {file && href && <div className="track-media"><strong>{file.name}</strong>
      <audio key={href} controls preload="metadata" src={href} aria-label="Original recording"
        onPlay={event => { if (!claimAudio()) event.currentTarget.pause(); }}
        onError={() => setError('This browser could not decode the selected audio.')} /></div>}
    {error && <p role="alert" className="analysis-alert">{error}</p>}
  </section>;
}

function LocalTrack({ claimAudio }: { claimAudio: () => boolean }) {
  const [status, setStatus] = useState<TrackStatus>();
  const [evidence, setEvidence] = useState<{ id: string; report: AnalysisReport }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestedReport = useRef('');
  const busyRef = useRef(false);

  useEffect(() => {
    let active = true;
    async function sync() {
      if (busyRef.current) return;
      try {
        const next = await analysisAction('status');
        if (!active) return;
        setStatus(next);
        if (next.reportReady && next.id && requestedReport.current !== next.id) {
          requestedReport.current = next.id;
          const raw = await analysisAction<string>('report');
          const report = readAnalysisReport(new TextEncoder().encode(raw));
          if (active) setEvidence({ id: next.id, report });
        }
      } catch (error) {
        if (active) setError(String(error));
      }
    }
    void sync();
    const timer = window.setInterval(sync, 400);
    return () => { active = false; window.clearInterval(timer); void stopTrackAudio(); };
  }, []);

  async function act(action: string, args?: Record<string, unknown>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      setStatus(await analysisAction(action, args));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  function togglePlayback() {
    if (busyRef.current) return;
    if (status?.playing) void act('pause');
    else if (claimAudio()) void act('play');
  }

  const report = evidence?.id === status?.id ? evidence?.report : undefined;
  const unavailable = Boolean(status?.reportReady && stems.some(([name]) => !status.available.includes(name)));
  const split = status?.drumSplit;
  const allDrums = status?.selected.includes('drums');
  const selectedParts = drumParts.filter(([name]) => status?.selected.includes(name)).length;
  const drumSelection = allDrums || selectedParts === drumParts.length ? true : selectedParts ? 'mixed' : false;

  return <section className="track-workspace" aria-labelledby="track-heading">
    <div className="destination-heading"><div><h2 id="track-heading">Analyze a recording</h2>
      <p>Audition the original and estimated stems, and see a description drawn from across the recording.</p></div>
      <div className="track-actions">
        <button className="destination-action" type="button" onClick={() => void act('configure')}
          disabled={busy || !status || status.running || split?.running}>{status?.connected ? 'Audio Analyst setup' : 'Connect Audio Analyst'}</button>
        <button className="destination-action" type="button" onClick={() => void act('start')}
          disabled={busy || !status?.connected || status.running || split?.running}>Choose track</button>
      </div></div>
    {status?.source && <>
      <div className="track-progress"><strong>{status.source}</strong>
        <div className="track-stage" aria-live="polite">{status.stage} · {status.percent}% of stages complete</div>
        <progress max={100} value={status.percent} aria-label="Analysis stages complete" />
        {status.running && <button type="button" className="destination-action" disabled={busy}
          onClick={() => void act('cancel')}>Cancel analysis</button>}
      </div>
      <div className="track-actions track-modes" role="group" aria-label="Recording playback">
        <button type="button" className="destination-action"
          disabled={busy || !status.available.includes('mix') || (!status.usesOriginal && !status.selected.length)}
          onClick={togglePlayback}>{status.playing ? 'Pause recording' : 'Play recording'}</button>
        <button type="button" className="destination-action" aria-pressed={status.usesOriginal}
          disabled={busy || !status.available.includes('mix')} onClick={() => void act('selectOriginal')}>Original</button>
        <button type="button" className="destination-action" aria-pressed={!status.usesOriginal}
          disabled={busy || !status.selected.length} onClick={() => void act('selectStems')}>Stem mix</button>
      </div>
      <div className="track-channels" role="group" aria-label="Stem groups to play together">
        {stems.map(([stem, label]) => <button key={stem} type="button" className="destination-action"
          aria-pressed={stem === 'drums' ? drumSelection : status.selected.includes(stem)} disabled={busy || !status.available.includes(stem)}
          onClick={() => void act('toggleStem', { stem })}>{label}</button>)}
      </div>
      {status.available.includes('drums') && split && <div className="track-drum-split">
        {split.ready ? <fieldset className="track-channels">
          <legend>Drum parts</legend>
          {drumParts.map(([stem, label]) => <button key={stem} type="button" className="destination-action"
            aria-pressed={allDrums || status.selected.includes(stem)} disabled={busy}
            onClick={() => void act('toggleStem', { stem })}>{label}</button>)}
        </fieldset> : <>
          <button type="button" className="destination-action"
            disabled={busy || status.running || (!split.running && !split.installed)}
            onClick={() => void act(split.running ? 'cancelDrumSplit' : 'splitDrums')}>
            {split.running ? 'Cancel drum split' : 'Split Drums'}
          </button>
          {!split.installed && <p>Set up the optional Inverse Drum Machine runtime in the Audio Analyst workspace.</p>}
        </>}
        {split.running && <div className="track-progress">
          <div className="track-stage" aria-live="polite">{split.stage} · {split.percent}%</div>
          <progress max={100} value={split.percent} aria-label="Drum split progress" />
        </div>}
        {split.error && <p role="alert" className="analysis-alert">{split.error}</p>}
      </div>}
      {status.duration > 0 && <div className="track-seek">
        <span>{clock(status.position)}</span>
        <input type="range" min={0} max={status.duration} step={.01} value={status.position} aria-label="Recording position"
          onChange={event => { const seconds = event.currentTarget.valueAsNumber; void act('seek', { seconds }); }} />
        <span>{clock(status.duration)}</span>
      </div>}
    </>}
    {unavailable && <p>Some stems are unavailable. Check that the local Demucs checkpoint is installed and separation succeeded.</p>}
    {(error || status?.error) && <p role="alert" className="analysis-alert">{error || status?.error}</p>}
    {report && <AnalysisEvidence report={report} auditionAt={seconds => {
      if (!busyRef.current && claimAudio()) void act('auditionOriginal', { seconds });
    }} />}
  </section>;
}
