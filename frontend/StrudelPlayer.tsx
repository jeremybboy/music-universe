import pattern from '../music/renditions/afterimage-intimate.strudel?raw';
import { hasStrudelRendition, strudelOrigin } from '../music/strudel.ts';

type Props = {
  songTitle: string; expression: string; world: string; bundledAfterimage: boolean;
  source: string; setSource: (source: string) => void; running: boolean; error: string;
  playPattern: () => void; stopPattern: () => void;
  handoff: boolean; disabled: boolean; pauseForExternal: (href: string) => void;
};

export function StrudelPlayer({ songTitle, expression, world, bundledAfterimage, handoff, disabled,
  pauseForExternal, source, setSource, running, error, playPattern, stopPattern }: Props) {
  const available = hasStrudelRendition({ isBundledAfterimage: bundledAfterimage, world });
  const mac = window.location.protocol === 'file:';
  return (
    <section className="destination strudel-destination" aria-labelledby="strudel-heading">
      <header className="destination-heading">
        <div><h1 id="strudel-heading">Strudel Player</h1><p>Write and audition a pattern in Music Universe.</p></div>
      </header>
      <div className="pattern-workbench">
        <div className="pattern-actions">
          <button type="button" className="destination-action" disabled={disabled || handoff}
            onClick={playPattern}>{running ? 'Restart pattern' : 'Run pattern'}</button>
          <button type="button" className="destination-action" disabled={!running} onClick={stopPattern}>Stop pattern</button>
          {available && <button type="button" className="destination-action" onClick={() => setSource(pattern)}>Load Afterimage pattern</button>}
        </div>
        <textarea aria-label="Pattern code" value={source} spellCheck={false} maxLength={12000}
          onChange={event => setSource(event.currentTarget.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (!disabled && !handoff) playPattern();
          } }} />
        {error && <p role="alert" className="analysis-alert">{error}</p>}
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
        <p>{mac ? 'The external Strudel player is available from Music Universe in a web browser.' :
          'Open the pattern in Strudel in a new tab and press Play there. Use that tab to stop playback.'}</p>
        {!mac && <button type="button" className="destination-action" disabled={handoff || disabled}
          onClick={() => pauseForExternal(strudelOrigin + '#' + encodeURIComponent(btoa(pattern)))}>Open in Strudel</button>}
        <details><summary>View original pattern</summary><pre><code>{pattern}</code></pre></details>
      </article> : <div className="destination-empty">
        <h2>No rendition for {songTitle} · {expression}</h2>
        <p>The bundled rendition is available for Afterimage’s Intimate expression.</p>
      </div>}
    </section>
  );
}
