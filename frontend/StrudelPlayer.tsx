import pattern from '../music/renditions/afterimage-intimate.strudel?raw';
import { hasStrudelRendition, strudelOrigin } from '../music/strudel.ts';

type Props = {
  songTitle: string; expression: string; world: string; bundledAfterimage: boolean;
  handoff: boolean; disabled: boolean; pauseForExternal: (href: string) => void;
};

export function StrudelPlayer({ songTitle, expression, world, bundledAfterimage, handoff, disabled,
  pauseForExternal }: Props) {
  const available = hasStrudelRendition({ isBundledAfterimage: bundledAfterimage, world });
  const mac = window.location.protocol === 'file:';
  return (
    <section className="destination strudel-destination" aria-labelledby="strudel-heading">
      <header className="destination-heading">
        <div><h1 id="strudel-heading">Strudel Player</h1><p>Audition an original rendition of the authored song.</p></div>
      </header>
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
