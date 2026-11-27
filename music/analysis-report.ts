import type { Universe } from './universe/model.ts';
import type { World } from './vocabulary.ts';

export const maxReportBytes = 2 * 1024 * 1024;
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
export type AnalysisReport = {
  source: string;
  excerpt: { start: number; duration: number; sampleRate: number };
  data: JsonObject;
  original: string;
};
export type AnalysisScope = 'song' | World;

export function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

export function objects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.flatMap(item => {
    const object = asObject(item);
    return object ? [object] : [];
  }) : [];
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function readAnalysisReport(bytes: Uint8Array): AnalysisReport {
  if (bytes.byteLength > maxReportBytes) throw new Error('Analysis reports must be 2 MiB or smaller.');
  let original: string;
  let parsed: unknown;
  try {
    original = decoder.decode(bytes);
    parsed = JSON.parse(original.startsWith('\uFEFF') ? original.slice(1) : original);
  } catch {
    throw new Error('Choose a valid UTF-8 Audio Analyst JSON report.');
  }

  const data = asObject(parsed);
  if (!data) throw new Error('The analysis report must be a JSON object.');
  if (data.schema_version !== 1) throw new Error('This player supports Audio Analyst schema_version 1.');
  if (typeof data.source !== 'string' || !data.source.trim() || data.source.length > 512) {
    throw new Error('The report needs a source excerpt name.');
  }
  const excerpt = asObject(data.excerpt);
  if (!excerpt || !finite(excerpt.start_s) || excerpt.start_s < 0 || !finite(excerpt.duration_s) ||
      excerpt.duration_s < 0 || !Number.isFinite(excerpt.start_s + excerpt.duration_s) ||
      !finite(excerpt.sample_rate_hz) || !Number.isInteger(excerpt.sample_rate_hz) || excerpt.sample_rate_hz <= 0) {
    throw new Error('The report needs valid excerpt timestamps and sample rate.');
  }

  const stack: [JsonValue, number][] = [[data, 0]];
  let nodes = 0;
  while (stack.length) {
    const [value, depth] = stack.pop()!;
    if (++nodes > 100_000 || depth > 24) throw new Error('The analysis report is too complex.');
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('The analysis report contains a nonfinite number.');
    }
    if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value)) stack.push([child, depth + 1]);
    }
  }

  for (const key of ['rhythm', 'tonality_and_hook', 'timbre', 'separation', 'group_audit',
    'reference_to_render_timing', 'semantics', 'compute']) {
    if (data[key] !== undefined && !asObject(data[key])) {
      throw new Error('The optional ' + key + ' section must be an object.');
    }
  }
  const semantics = asObject(data.semantics);
  if (semantics) validateSemantics(semantics);

  return { source: data.source, excerpt: { start: excerpt.start_s, duration: excerpt.duration_s,
    sampleRate: excerpt.sample_rate_hz }, data, original };
}

function validateSemantics(semantics: JsonObject) {
  if (semantics.embedding !== undefined &&
      (!Array.isArray(semantics.embedding) || !semantics.embedding.length || !semantics.embedding.every(finite))) {
    throw new Error('The saved audio embedding must contain finite numbers.');
  }
  const hasScores = semantics.prompt_similarity !== undefined || semantics.status === 'candidate';
  if (!hasScores) return;
  const prompts = semantics.prompts;
  const scores = semantics.prompt_similarity;
  if (typeof semantics.method !== 'string' || typeof semantics.model !== 'string' ||
      semantics.score_type !== 'cosine_similarity' ||
      !Array.isArray(prompts) || !prompts.length ||
      !Array.isArray(scores) || prompts.length !== scores.length) {
    throw new Error('CLAP2 evidence needs model details and one cosine score per prompt.');
  }
  const counts = new Map<string, number>();
  for (const prompt of prompts) {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('A CLAP2 prompt is invalid.');
    counts.set(prompt, (counts.get(prompt) ?? 0) + 1);
  }
  for (const item of scores) {
    const score = asObject(item);
    if (!score || typeof score.prompt !== 'string' || !counts.get(score.prompt) ||
        !finite(score.cosine) || Math.abs(score.cosine) > 1.000001) {
      throw new Error('CLAP2 scores must match the supplied prompts and contain valid cosine values.');
    }
    counts.set(score.prompt, counts.get(score.prompt)! - 1);
  }
}

export class AnalysisSession {
  private readonly bySong = new WeakMap<Universe, Map<AnalysisScope, AnalysisReport>>();

  attach(song: Universe, scope: AnalysisScope, report: AnalysisReport) {
    if (scope !== 'song' && !song.expressions.some(expression => expression.id === scope)) {
      throw new Error('That expression is unavailable for this song.');
    }
    const reports = this.bySong.get(song) ?? new Map<AnalysisScope, AnalysisReport>();
    reports.set(scope, report);
    this.bySong.set(song, reports);
  }

  get(song: Universe, scope: AnalysisScope) {
    return this.bySong.get(song)?.get(scope);
  }
}
