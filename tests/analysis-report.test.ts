import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AnalysisSession, maxReportBytes, readAnalysisReport } from '../music/analysis-report.ts';
import { hasStrudelRendition } from '../music/strudel.ts';
import { readUniverse } from '../music/universe/model.ts';
import { beaconPackage } from './fixtures.mjs';

const generated = readFileSync(new URL('./fixtures/synthetic-analysis-v1.json', import.meta.url));
const minimal = { schema_version: 1, source: 'synthetic excerpt', excerpt: { start_s: 3.25, duration_s: 8, sample_rate_hz: 48000 } };
const read = (data: unknown) => readAnalysisReport(Buffer.from(JSON.stringify(data)));

test('the real synthetic audio report retains source, scores, embedding, and original JSON', () => {
  const report = readAnalysisReport(generated);
  const actual = JSON.parse(generated.toString('utf8'));
  assert.equal(report.source, 'synthetic-pulse.wav');
  assert.deepEqual(report.excerpt, { start: 1, duration: 8, sampleRate: 48_000 });
  assert.equal(report.original, generated.toString('utf8'));
  assert.deepEqual(report.data, actual);
  assert.equal(actual.semantics.method, 'LAION CLAP2');
  assert.equal(actual.semantics.prompt_similarity.length, actual.semantics.prompts.length);
  assert.equal(actual.semantics.embedding.length, 224);
  assert.deepEqual(Object.keys(actual.group_audit.groups).sort(), ['bass', 'drums', 'mix', 'other', 'vocals']);
});

test('minimal reports and explicit unavailable model states are accepted', () => {
  assert.equal(read(minimal).data.semantics, undefined);
  const withBom = '\uFEFF' + JSON.stringify(minimal);
  assert.equal(readAnalysisReport(Buffer.from(withBom)).original, withBom);
  const failed = read({ ...minimal, semantics: { status: 'failed', error: 'Model unavailable' },
    group_audit: { status: 'separation_unavailable' } });
  assert.equal(failed.data.semantics.status, 'failed');
  assert.equal(failed.data.group_audit.status, 'separation_unavailable');
});

test('rejects unsupported, malformed, oversized, and inconsistent evidence', () => {
  assert.throws(() => readAnalysisReport(Buffer.from('{')), /valid UTF-8/);
  assert.throws(() => readAnalysisReport(Buffer.from([255, 255])), /valid UTF-8/);
  assert.throws(() => read({ ...minimal, schema_version: 2 }), /schema_version 1/);
  assert.throws(() => read({ ...minimal, excerpt: { start_s: -1 } }), /timestamps/);
  assert.throws(() => read({ ...minimal, rhythm: [] }), /must be an object/);
  assert.throws(() => readAnalysisReport(Buffer.alloc(maxReportBytes + 1)), /2 MiB/);
  assert.throws(() => readAnalysisReport(Buffer.from(JSON.stringify(minimal).replace('3.25', '1e999'))), /timestamps/);
  assert.throws(() => read({ ...minimal, semantics: { embedding: [0, 'invalid'] } }), /embedding/);
  const semantics = { status: 'candidate', method: 'LAION CLAP2', model: 'synthetic example',
    score_type: 'cosine_similarity', prompts: ['first'], prompt_similarity: [{ prompt: 'different', cosine: .12 }] };
  assert.throws(() => read({ ...minimal, semantics }), /must match/);
  const nested = '['.repeat(25) + '"test"' + ']'.repeat(25);
  assert.throws(() => read({ ...minimal, data: JSON.parse(nested) }), /too complex/);
});

test('report binding isolates package instances and exact expressions', () => {
  const archive = readFileSync(new URL('../songs/Afterimage.muv', import.meta.url));
  const afterimage = readUniverse(archive);
  const reopened = readUniverse(archive);
  const other = readUniverse(beaconPackage());
  const report = readAnalysisReport(generated);
  const session = new AnalysisSession();
  session.attach(afterimage, 'intimate', report);
  assert.equal(session.get(afterimage, 'intimate'), report);
  assert.equal(session.get(afterimage, 'club'), undefined);
  assert.equal(session.get(afterimage, 'song'), undefined);
  assert.equal(session.get(other, 'intimate'), undefined);
  assert.equal(session.get(reopened, 'intimate'), undefined);
  assert.throws(() => readAnalysisReport(Buffer.from('bad')), /valid UTF-8/);
  assert.equal(session.get(afterimage, 'intimate'), report);
  session.attach(afterimage, 'song', read(minimal));
  assert.equal(session.get(afterimage, 'intimate'), report);
  assert.equal(session.get(afterimage, 'song').source, minimal.source);
});

test('the only Strudel rendition belongs to bundled Afterimage Intimate', () => {
  assert.equal(hasStrudelRendition({ isBundledAfterimage: true, world: 'intimate' }), true);
  assert.equal(hasStrudelRendition({ isBundledAfterimage: true, world: 'club' }), false);
  assert.equal(hasStrudelRendition({ isBundledAfterimage: false, world: 'intimate' }), false);
});
