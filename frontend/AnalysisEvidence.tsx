import type { ReactNode } from 'react';
import { MusicProfile } from './MusicProfile.tsx';
import { asObject, objects, type AnalysisReport, type JsonObject, type JsonValue } from '../music/analysis-report.ts';

const text = (value: JsonValue | undefined) => typeof value === 'string' ? value : '';
const numeric = (value: JsonValue | undefined, unit = '') =>
  typeof value === 'number' ? String(value) + unit : '—';
const words = (value: JsonValue | undefined) => Array.isArray(value) ?
  value.filter((item): item is string => typeof item === 'string') : [];
const statusLabels: Record<string, string> = {
  candidate: 'Candidate', failed: 'Failed', measured: 'Measured', ambiguous: 'Ambiguous',
  not_requested: 'Not requested', insufficient_signal: 'Insufficient signal',
  separation_unavailable: 'Separation unavailable', needs_render_and_anchors: 'Needs a render and anchors',
};

function status(value: JsonValue | undefined, fallback = 'No data') {
  const code = text(value);
  return Object.hasOwn(statusLabels, code) ? statusLabels[code] : code || fallback;
}

function Evidence({ title, section, children }: { title: string; section?: JsonObject; children?: ReactNode }) {
  const metadata = [text(section?.method), text(section?.model)].filter(Boolean);
  const limits = words(section?.limitations);
  return (
    <section className="evidence-card">
      <div className="evidence-card-title"><h3>{title}</h3>
        <span className="evidence-status">{status(section?.status, section ? 'Status not supplied' : 'No data')}</span></div>
      {metadata.length > 0 && <p className="evidence-method">{metadata.join(' · ')}</p>}
      {typeof section?.checkpoint_bytes === 'number' &&
        <p className="evidence-method">Checkpoint size {section.checkpoint_bytes.toLocaleString()} bytes</p>}
      {children}
      {(text(section?.error) || text(section?.reason)) && <p>{text(section?.error) || text(section?.reason)}</p>}
      {limits.length > 0 && <p className="evidence-limits">{limits.join(' · ')}</p>}
    </section>
  );
}

function Table({ caption, columns, rows }: { caption: string; columns: string[]; rows: string[][] }) {
  if (!rows.length) return <p>No {caption.toLowerCase()} in this report.</p>;
  return <div className="evidence-table" tabIndex={0} aria-label={caption}>
    <table aria-label={caption}>
      <thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function keyRows(value: JsonValue | undefined) {
  return objects(value).map(row => [[text(row.key), text(row.mode)].filter(Boolean).join(' ') || '—',
    numeric(row.profile_correlation ?? row.strength)]);
}

const seconds = (value: JsonValue | undefined) => numeric(value, ' s');
const range = (start: JsonValue | undefined, end: JsonValue | undefined) => seconds(start) + ' – ' + seconds(end);
const names = { mix: 'Stereo mix', drums: 'Estimated drums', bass: 'Estimated bass',
  other: 'Estimated accompaniment', vocals: 'Estimated vocals' };

export function AnalysisEvidence({ report, auditionAt }: { report: AnalysisReport; auditionAt?: (seconds: number) => void }) {
  const { data } = report;
  const rhythm = asObject(data.rhythm);
  const learned = asObject(rhythm?.learned);
  const tonal = asObject(data.tonality_and_hook);
  const hook = asObject(tonal?.hook);
  const essentia = asObject(tonal?.essentia);
  const timbre = asObject(data.timbre);
  const semantics = asObject(data.semantics);
  const profile = asObject(data.song_profile);
  const semanticExcerpt = asObject(semantics?.excerpt);
  const separation = asObject(data.separation);
  const groupAudit = asObject(data.group_audit);
  const groups = asObject(groupAudit?.groups);
  const inferredStems = words(separation?.stems);
  const windows = objects(tonal?.windows);
  const timing = asObject(data.reference_to_render_timing);
  const hits = objects(timbre?.marked_hits);
  const drumHits = objects(timbre?.estimated_drums_hits);
  const marks = Array.isArray(learned?.beats) ? learned.beats : [];
  const downbeats = Array.isArray(learned?.downbeats) ? learned.downbeats :
    Array.isArray(rhythm?.downbeats) ? rhythm.downbeats : [];
  const pitches = objects(hook?.notes);
  const scores = objects(semantics?.prompt_similarity);
  const groupRows = Object.entries(names).flatMap(([id, label]) => {
    const group = asObject(groups?.[id]);
    if (!group) return [];
    const features = asObject(group.timbre);
    const topKey = keyRows(group.key_candidates ?? asObject(group.key)?.candidates)[0];
    return [[label, numeric(features?.stereo_rms_dbfs, ' dBFS'),
      numeric(group.rms_relative_to_mix_db, ' dB'), numeric(features?.spectral_centroid_hz, ' Hz'),
      topKey?.[0] ?? '—']];
  });
  return (
    <>
    {profile && <MusicProfile profile={profile} auditionAt={auditionAt} />}
    <div className="evidence-grid" aria-label="Recording evidence">
      <Evidence title="Tempo and pulse" section={rhythm}>
        <Table caption="Tempo candidates" columns={['Tempo', 'Periodicity']} rows={objects(rhythm?.bpm_candidates)
          .map(row => [numeric(row.bpm, ' BPM'), numeric(row.periodicity)])} />
        <p><strong>Beat tracker</strong> {text(learned?.method) || '—'} {text(learned?.model)} ·
          {' '}{status(learned?.status)}
          {typeof learned?.bpm_median_interval === 'number' && ' · ' + numeric(learned.bpm_median_interval, ' BPM')}</p>
        {(marks.length > 0 || downbeats.length > 0) && <details>
          <summary>Timestamped beats ({marks.length}) and downbeats ({downbeats.length})</summary>
          {marks.length > 0 && <p><strong>Beats</strong> {marks.map(seconds).join(' · ')}</p>}
          {downbeats.length > 0 && <p><strong>Downbeats</strong> {downbeats.map(seconds).join(' · ')}</p>}
        </details>}
        {text(learned?.error) && <p>{text(learned?.error)}</p>}
      </Evidence>
      <Evidence title="Key candidates" section={tonal}>
        <Table caption="Key candidates" columns={['Key', 'Correlation']} rows={keyRows(tonal?.candidates)} />
        {windows.length > 0 && <details><summary>Timestamped key windows ({windows.length})</summary>
          <Table caption="Key windows" columns={['Source time', 'Key', 'Correlation']} rows={windows.flatMap(window =>
            keyRows(window.candidates).map(row => [range(window.start_s, window.end_s), ...row]))} />
        </details>}
        {essentia && <details><summary>Essentia comparison · {status(essentia.status)}</summary>
          <Table caption="Essentia windows" columns={['Source time', 'Key', 'Strength']} rows={objects(essentia.windows)
            .map(row => [range(row.start_s, row.end_s), text(row.key) + ' ' + text(row.mode), numeric(row.strength)])} />
          {text(essentia.error) && <p>{text(essentia.error)}</p>}
        </details>}
        <p>These estimates do not establish chords or voicings.</p>
      </Evidence>
      <Evidence title="Hook and note candidates" section={hook}>
        {text(hook?.input_kind) && <p>Input {text(hook?.input_kind)}</p>}
        <Table caption="Hook candidates" columns={['Source time', 'MIDI note', 'Model amplitude']} rows={pitches
          .map(note => [range(note.onset_s, note.offset_s), numeric(note.midi), numeric(note.model_amplitude)])} />
      </Evidence>
      <Evidence title="Timbre" section={timbre}>
        {timbre && <dl className="evidence-metrics">
          <div><dt>Peak</dt><dd>{numeric(timbre.sample_peak_dbfs, ' dBFS')}</dd></div>
          <div><dt>RMS</dt><dd>{numeric(timbre.stereo_rms_dbfs, ' dBFS')}</dd></div>
          <div><dt>Side vs. mid</dt><dd>{numeric(timbre.side_to_mid_db, ' dB')}</dd></div>
          <div><dt>Spectral centroid</dt><dd>{numeric(timbre.spectral_centroid_hz, ' Hz')}</dd></div>
          <div><dt>85% roll-off</dt><dd>{numeric(timbre.spectral_rolloff_85_hz, ' Hz')}</dd></div>
        </dl>}
        {hits.length + drumHits.length > 0 && <details><summary>Marked hit candidates</summary>
          <Table caption="Hit estimates" columns={['Input', 'Marker', 'Estimated onset', 'Attack']} rows={[
            ...hits.map(hit => ['Stereo mix', hit] as const), ...drumHits.map(hit => ['Estimated drums', hit] as const),
          ].map(([input, hit]) => [input, seconds(hit.marker_s), seconds(hit.audible_onset_s_estimate),
            numeric(hit.attack_10_to_90_ms, ' ms')])} /></details>}
      </Evidence>
      {(!profile || semantics?.status === 'candidate') && <Evidence title="CLAP2 prompt similarity" section={semantics}>
        {semanticExcerpt && <p>Model excerpt starts at {seconds(semanticExcerpt.start_s)} · {seconds(semanticExcerpt.duration_s)} long</p>}
        <Table caption="CLAP2 scores" columns={['Prompt', 'Cosine similarity']}
          rows={scores.map(row => [text(row.prompt), numeric(row.cosine)])} />
        <p>{Array.isArray(semantics?.embedding) ?
          'Audio embedding retained · ' + semantics.embedding.length + ' values' : 'No audio embedding saved.'}</p>
      </Evidence>}
      <Evidence title="Demucs estimates" section={separation}>
        <p>Drums, bass, accompaniment, and vocals are model estimates.</p>
        {inferredStems.length > 0 && <p>Reported groups {inferredStems.map(name => Object.hasOwn(names, name) ? names[name as keyof typeof names] : name).join(' · ')}</p>}
        <p>Group audit · {status(groupAudit?.status)}</p>
        <Table caption="Stereo vs. estimated groups" columns={['Input', 'RMS', 'vs. mix', 'Centroid', 'Key candidate']} rows={groupRows} />
        {words(groupAudit?.limitations).length > 0 && <p className="evidence-limits">{words(groupAudit?.limitations).join(' · ')}</p>}
      </Evidence>
      {timing && <Evidence title="Reference and render timing" section={timing}>
        <Table caption="Anchored timing candidates" columns={['Part', 'Source anchor', 'Render anchor', 'Render lateness']} rows={objects(timing.events)
          .map(row => [text(row.part), seconds(row.reference_anchor_s), seconds(row.render_anchor_s),
            numeric(row.relative_render_lateness_ms, ' ms')])} />
      </Evidence>}
    </div>
    </>
  );
}
