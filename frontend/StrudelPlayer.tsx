import pattern from '../music/renditions/afterimage-intimate.strudel?raw';
import { hasStrudelRendition } from '../music/strudel.ts';

type Props = {
  songTitle: string; expression: string; world: string; bundledAfterimage: boolean;
  source: string; setSource: (source: string) => void; running: boolean; error: string;
  playPattern: () => void; stopPattern: () => void;
  handoff: boolean; disabled: boolean; pauseForExternal: (source: string) => Promise<void>;
};

export function StrudelPlayer({ songTitle, expression, world, bundledAfterimage, handoff, disabled,
  pauseForExternal, source, setSource, running, error, playPattern, stopPattern }: Props) {
  const available = hasStrudelRendition({ isBundledAfterimage: bundledAfterimage, world });
  return (
    <section className="destination strudel-destination" aria-labelledby="strudel-heading">
      <header className="destination-heading">
        <div><h1 id="strudel-heading">Strudel Player</h1><p>Run simple patterns offline or open full arrangements in the Strudel REPL.</p></div>
      </header>
      <div className="pattern-workbench">
        <div className="pattern-actions">
          <button type="button" className="destination-action" disabled={disabled || handoff}
            onClick={playPattern}>{running ? 'Restart pattern' : 'Run pattern'}</button>
          <button type="button" className="destination-action" disabled={!running} onClick={stopPattern}>Stop pattern</button>
          <button type="button" className="destination-action" disabled={disabled || handoff || !source.trim()}
            aria-describedby="strudel-open-help" onClick={() => void pauseForExternal(source)}>Open in Strudel</button>
          {available && <button type="button" className="destination-action" onClick={() => setSource(pattern)}>Load Afterimage pattern</button>}
        </div>
        <textarea aria-label="Pattern code" value={source} spellCheck={false} maxLength={12000}
          onChange={event => setSource(event.currentTarget.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (!disabled && !handoff) playPattern();
          } }} />
        {error && <p role="alert" className="analysis-alert">{error}</p>}
        <p id="strudel-open-help">Open in Strudel sends the current editor code to strudel.cc in your browser.</p>
        <details><summary>Supported pattern syntax</summary>
          <p>Use <code>setcps(84/60/4)</code> for BPM, <code>$: note("c4 ~ [e4,g4] ~").s("triangle")</code> for notes,
            and <code>$: s("bd hh sd hh")</code> for drums. Angle brackets alternate cycles. Use Run pattern or Ctrl/⌘+Enter to apply edits.</p>
          <p>Music Universe supports a subset of Strudel syntax with its own synthesizer. Available settings are gain, attack, release, and lpf.</p>
        </details>
      </div>
      {available ? <article className="strudel-rendition">
        <div className="analysis-kicker">Original rendition</div>
        <h2>{songTitle} · {expression}</h2>
        <p>84 BPM · Eight bars · Synthetic lead, keys and bass</p>
        <details><summary>View original pattern</summary><pre><code>{pattern}</code></pre></details>
      </article> : <div className="destination-empty">
        <h2>No rendition for {songTitle} · {expression}</h2>
        <p>The bundled rendition is available for Afterimage’s Intimate expression.</p>
      </div>}
    </section>
  );
}
