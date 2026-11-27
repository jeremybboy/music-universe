import { asObject, objects, type JsonObject, type JsonValue } from '../music/analysis-report.ts';

const labels = [
  ['genre', 'Genres and influences'], ['mood', 'Mood and feeling'], ['energy', 'Energy'],
  ['groove', 'Groove and phrasing'], ['instruments', 'Instruments and voices'], ['production', 'Sound and production'],
] as const;

const clock = (time: number) => Math.floor(time / 60) + ':' + String(Math.floor(time % 60)).padStart(2, '0');
const label = (value: JsonValue | undefined) => typeof value === 'string' ? value : '';
const list = new Intl.ListFormat('en', { type: 'conjunction' });

export function MusicProfile({ profile, auditionAt }: { profile: JsonObject; auditionAt?: (seconds: number) => void }) {
  const facets = asObject(profile.facets);
  const groups = labels.map(([id, title]) => ({ id, title, choices: objects(facets?.[id]) }));
  const choices = (id: string, count: number) =>
    list.format(groups.find(group => group.id === id)?.choices.slice(0, count).map(choice => label(choice.label)).filter(Boolean) ?? []);
  const genres = choices('genre', 2);
  const mood = choices('mood', 2);
  const groove = choices('groove', 2);
  const instruments = choices('instruments', 2);
  const production = choices('production', 2);
  const energy = choices('energy', 1);
  const count = Array.isArray(profile.excerpts) ? profile.excerpts.length : 0;
  const inventory = Array.isArray(profile.inventory) ? profile.inventory.length : 0;

  return <section className="music-profile" aria-label="Song description">
    <div className="evidence-card-title"><h3>Song description</h3>
      <span className="evidence-status">{profile.status === 'candidate' ? 'Model candidates' : 'Unavailable'}</span></div>
    {profile.status === 'candidate' ? <>
      <p>{genres && <>The closest style matches are <strong>{genres}</strong>. </>}
        {mood && <>Mood candidates are <strong>{mood}</strong>. </>}
        {energy && <>The energy is closest to <strong>{energy}</strong>. </>}
        {groove && <>Groove cues include {groove}. </>}
        {instruments && <>Likely sound sources include {instruments}. </>}
        {production && <>The recording suggests {production}.</>}</p>
      <p className="evidence-method">
        {label(profile.model)} · {count} {count === 1 ? 'excerpt' : 'excerpts'} · {inventory} descriptions compared
        {typeof profile.duration_s === 'number' && ' · ' + clock(profile.duration_s) + ' track'}
      </p>
      <div className="music-profile-facets">
        {groups.filter(group => group.choices.length).map(({ id, title, choices }) =>
          <section key={id} className="evidence-card">
            <h4>{title}</h4>
            <ul>{choices.slice(0, id === 'genre' ? 5 : 3).map(choice => {
              const name = label(choice.label);
              const start = choice.peak_start_s;
              const end = choice.peak_end_s;
              const span = typeof start === 'number' && typeof end === 'number' ? clock(start) + '–' + clock(end) : '';
              return <li key={name}><span>{name}</span>
                {span && (auditionAt && typeof start === 'number' ? <button type="button" className="destination-action"
                  aria-label={`Play strongest excerpt for ${name} at ${clock(start)}`} onClick={() => auditionAt(start)}>{span}</button>
                  : <span className="evidence-method">{span}</span>)}</li>;
            })}</ul>
            <details><summary>All {choices.length} comparisons</summary>
              <ol>{choices.map(choice => <li key={label(choice.label)}>
                <span>{label(choice.label)}</span>
                {typeof choice.mean_cosine === 'number' && <span className="evidence-method">{choice.mean_cosine.toFixed(3)}</span>}
              </li>)}</ol>
            </details>
          </section>)}
      </div>
      <p className="evidence-limits">Timestamps show the strongest matching excerpt for each description. The full score list shows average similarity across analyzed excerpts.</p>
    </> : <p>{label(profile.error) || label(profile.reason) || 'The recording did not contain enough signal to compare descriptions.'}</p>}
  </section>;
}
