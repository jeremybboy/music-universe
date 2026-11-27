# Strudel Player

The in-app editor plays a small subset of Strudel syntax on web and macOS using the Music Universe synthesizer. Edit the text and select **Run pattern** or press Control/Command+Enter. **Stop pattern**, leaving the editor, or starting the main player stops the pattern. A syntax error leaves the currently playing pattern in place. Editor text lasts for the current session.

```js
setcps(112/60/4)
$: note("<[a3 ~ c4 e4] [g3 ~ b3 d4]>").s("triangle").lpf(2400).gain(.2)
$: s("bd hh sd hh").gain(.24)
```

The editor supports notes, rests, chords, subdivisions, alternating cycles, four oscillator shapes, synthesized kick/snare/hat, gain, attack, release, and a low-pass filter. It parses text into a bounded event schedule. Full Strudel libraries, JavaScript expressions, external samples, and arbitrary effects require the official runtime.

## Original rendition and official REPL

Choose Afterimage’s Intimate expression and open **Strudel Player**. The rendition uses the original eight-bar lead, harmony, and bass as material, with timing placed on a sixteenth-note grid and synthetic voices. Other songs and expressions show an unavailable state.

In a browser, **Open in Strudel** pauses Music Universe and opens the official Strudel REPL in a new tab with the checked-in pattern. Use the Play and Stop controls in that tab. After stopping or closing the external tab, select **I stopped Strudel** in Music Universe and press Play to resume the authored player. Music Universe cannot observe the external tab’s playback state, so this handoff requires that acknowledgement. If the browser blocks the tab, acknowledge the handoff, allow the new tab, and try again.

The Mac bundle auditions the supported pattern offline. Opening the official REPL requires the web app and an internet connection to Strudel. The project uses its own pattern parser and synthesizer in the app. The [official Strudel embedding guidance](https://strudel.cc/technical-manual/project-start/) describes the AGPL-3.0 terms and calls for a compatible project license for an integrated distribution. Music Universe has no declared repository license, so the PR uses the documented standalone REPL link.
