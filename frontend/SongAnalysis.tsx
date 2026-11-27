import { useRef, useState, type ChangeEvent } from 'react';
import { maxReportBytes, readAnalysisReport, type AnalysisReport, type AnalysisScope, type AnalysisSession }
  from '../music/analysis-report.ts';
import { expressionFor, type Universe } from '../music/universe/model.ts';
import type { World } from '../music/vocabulary.ts';
import { AnalysisEvidence } from './AnalysisEvidence.tsx';

type Props = { song: Universe; world: World; session: AnalysisSession };
type Draft = { song: Universe; world: World; report: AnalysisReport };

export function SongAnalysis({ song, world, session }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [scope, setScope] = useState<AnalysisScope>('song');
  const [preferred, setPreferred] = useState<AnalysisScope>('song');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const candidate = draft?.song === song ? draft : null;
  const expression = expressionFor(song, world).label;
  const bySong = session.get(song, 'song');
  const byWorld = session.get(song, world);
  const activeScope = byWorld && (preferred === world || !bySong) ? world : 'song';
  const report = activeScope === 'song' ? bySong : byWorld;

  async function read(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setReading(true);
    setError('');
    setNotice('');
    setDraft(null);
    try {
      if (file.size > maxReportBytes) throw new Error('Analysis reports must be 2 MiB or smaller.');
      const report = readAnalysisReport(new Uint8Array(await file.arrayBuffer()));
      setDraft({ song, world, report });
      setScope('song');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The analysis report could not be read.');
    } finally {
      setReading(false);
    }
  }

  function attach() {
    if (!candidate) return;
    session.attach(song, scope, candidate.report);
    setPreferred(scope);
    setDraft(null);
    setNotice('Report attached to ' + song.identity.title +
      (scope !== 'song' ? ' · ' + expressionFor(song, scope).label : ' · all expressions') + '.');
  }

  function exportReport() {
    if (!report) return;
    const href = URL.createObjectURL(new Blob([report.original], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = 'audio-analyst-report.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  return (
    <section className="destination" aria-labelledby="analysis-heading">
      <header className="destination-heading">
        <div><h1 id="analysis-heading">Song Analysis</h1>
          <p>Inspect evidence from a source excerpt alongside {song.identity.title}.</p></div>
        <button type="button" className="destination-action" disabled={reading}
          onClick={() => fileInput.current?.click()}>{reading ? 'Reading report…' : 'Import analysis report'}</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={read} />
      </header>
      {error && <p role="alert" className="analysis-alert">{error}</p>}
      {notice && <p aria-live="polite" className="analysis-notice">{notice}</p>}
      {candidate && <section className="analysis-confirm" aria-labelledby="attach-heading">
        <h2 id="attach-heading">Confirm report association</h2>
        <p>Source <strong>{candidate.report.source}</strong> · {clipRange(candidate.report)} · {candidate.report.excerpt.sampleRate} Hz</p>
        <p>Confirm that this excerpt belongs with {song.identity.title}.</p>
        <label>Attach to <select value={scope}
          onChange={event => setScope(event.target.value === 'song' ? 'song' : candidate.world)}>
          <option value="song">{song.identity.title} · all expressions</option>
          <option value={candidate.world}>{song.identity.title} · {expressionFor(song, candidate.world).label}</option>
        </select></label>
        <div className="analysis-confirm-actions">
          <button type="button" className="destination-action" onClick={attach}>Attach report</button>
          <button type="button" className="destination-action" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </section>}
      {report ? <>
        <div className="analysis-source">
          <div><p className="analysis-kicker">Recording evidence · v1</p><h2>{report.source}</h2>
            <p>{clipRange(report)} · {report.excerpt.sampleRate.toLocaleString()} Hz</p>
            <p>Attached to {song.identity.title} · {activeScope === 'song' ? 'all expressions' : expression}</p></div>
          <div className="analysis-source-actions">
            {bySong && byWorld && <label>Show report <select value={activeScope}
              onChange={event => setPreferred(event.target.value === 'song' ? 'song' : world)}>
              <option value="song">All expressions</option><option value={world}>{expression}</option>
            </select></label>}
            {window.location.protocol !== 'file:' && <button type="button" className="destination-action"
              onClick={exportReport}>Download report JSON</button>}
          </div>
        </div>
        <p className="analysis-disclaimer">Candidate findings describe the recording excerpt. Authored song metadata stays in Discover.</p>
        <AnalysisEvidence report={report} />
      </> : <div className="destination-empty">
        <h2>No report attached</h2>
        <p>Import a local Audio Analyst JSON report, then confirm its association with this song or expression.</p>
      </div>}
    </section>
  );
}

function clipRange(report: AnalysisReport) {
  const { start, duration } = report.excerpt;
  return start.toFixed(3) + ' s – ' + (start + duration).toFixed(3) + ' s';
}
