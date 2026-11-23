import { instrumentLabels } from '../music/state.ts';
import type { Playback } from '../music/transport.ts';
import { canTransition, expressionFor, type Universe } from '../music/universe/model.ts';
import type { World } from '../music/vocabulary.ts';

type Props = {
  song: Universe;
  state: Playback;
  currentBar: number;
  selectWorld: (world: World) => void;
};

export function Discover({ song, state, currentBar, selectWorld }: Props) {
  const { identity, expressions, roles, possibilities } = song;
  const current = expressionFor(song, state.config.world);
  const origin = expressionFor(song, state.transitionFrom);
  const section = identity.sections.find(part =>
    currentBar >= part.start_bar && currentBar < part.start_bar + part.bars);
  const activeRoles = roles.filter(role => state.config.layers[role]).map(role => instrumentLabels[role]);

  return (
    <section id="discover" className="discover" aria-labelledby="discover-heading">
      <header className="discover-heading">
        <h1 id="discover-heading">Discover</h1>
        <p>Explore the parts that make up {identity.title} and the choices the artist built into it.</p>
      </header>

      <div className="discover-grid">
        <section className="discover-identity" aria-labelledby="identity-heading">
          <h2 id="identity-heading">Musical identity</h2>
          <h3>{identity.title}</h3>
          {identity.artist && <p>{identity.artist}</p>}
          <p className="discover-meta">
            {identity.meter.join('/')} · {identity.bars} {identity.bars === 1 ? 'bar' : 'bars'}
            {identity.key && ' · ' + identity.key}
          </p>
          {identity.anchors.length > 0 &&
            <ul className="discover-anchors">{identity.anchors.map((anchor, index) => <li key={index}>{anchor}</li>)}</ul>}
          {identity.harmony.length > 0 &&
            <p className="harmony"><span>Harmony</span>{identity.harmony.join(' · ')}</p>}
        </section>

        <section className="discover-expressions" aria-labelledby="expressions-heading">
          <h2 id="expressions-heading">Musical expression</h2>
          <p>Authored worlds · choose a path the artist permits</p>
          <ul className="expression-path" aria-label={'Worlds available from ' + origin.label}>
            {expressions.map(expression => {
              const active = expression.id === current.id;
              const queued = !active && state.pending?.config.world === expression.id;
              const allowed = canTransition(song, origin.id, expression.id);
              return <li key={expression.id}>
                <button type="button" className={'expression-node world-' + expression.id}
                  aria-pressed={(state.pending?.config.world ?? current.id) === expression.id} disabled={!allowed}
                  onClick={() => selectWorld(expression.id)}>
                  <span className="expression-orb" aria-hidden="true"></span>
                  <span className="expression-name">{expression.label}</span>
                  <span className="expression-tempo">{expression.bpm} BPM</span>
                  <span className="expression-state">{active ? 'Active' : queued ? 'Queued' : allowed ? 'Available' : 'Unavailable'}</span>
                </button>
                <p className="expression-description">
                  {[expression.mood, expression.energy_label ?? Math.round(expression.energy * 100) + '% energy',
                    expression.texture].filter(Boolean).join(' · ')}
                </p>
              </li>;
            })}
          </ul>
          <div className="discover-permissions">
            <p><strong>Roles</strong> {roles.map(role => instrumentLabels[role]).join(' · ')}</p>
            <p><strong>Allowed transitions</strong> {possibilities.transitions.length ?
              possibilities.transitions.map(({ from, to }) =>
                expressionFor(song, from).label + ' → ' + expressionFor(song, to).label).join(' · ') : 'None'}</p>
          </div>
        </section>

        <section className="discover-realization" aria-labelledby="realization-heading">
          <h2 id="realization-heading">Musical realization</h2>
          <p>The player’s current settings</p>
          <dl>
            <div><dt>World</dt><dd>{current.label}</dd></div>
            <div><dt>Tempo</dt><dd>{current.bpm} BPM</dd></div>
            <div><dt>Mood</dt><dd>{state.config.mood}</dd></div>
            <div><dt>Energy</dt><dd>{Math.round(state.config.energy * 100)}%</dd></div>
            <div><dt>Bar</dt><dd data-testid="discover-bar">{currentBar} / {identity.bars}</dd></div>
            <div><dt>Layers</dt><dd>{activeRoles.join(' · ') || 'All muted'}</dd></div>
          </dl>
        </section>
      </div>

      <ol className="discover-sections" aria-label="Authored song sections">
        {identity.sections.map(part => <li key={part.id}
          aria-current={section?.id === part.id ? 'step' : undefined} style={{ flexGrow: part.bars }}>
          <strong>{part.label}</strong>
          <span>{part.bars === 1 ? 'Bar ' + part.start_bar : 'Bars ' + part.start_bar + '–' + (part.start_bar + part.bars - 1)}</span>
        </li>)}
      </ol>
    </section>
  );
}
