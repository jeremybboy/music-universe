# Strudel Player

Choose Afterimage’s Intimate expression and open **Strudel Player**. The rendition uses the original eight-bar lead, harmony, and bass as material, with timing placed on a sixteenth-note grid and synthetic voices. Other songs and expressions show an unavailable state.

In a browser, **Open in Strudel** pauses Music Universe and opens the official Strudel REPL in a new tab with the checked-in pattern. Use the Play and Stop controls in that tab. After stopping or closing the external tab, select **I stopped Strudel** in Music Universe and press Play to resume the authored player. Music Universe cannot observe the external tab’s playback state, so this handoff requires that acknowledgement. If the browser blocks the tab, acknowledge the handoff, allow the new tab, and try again.

The Mac bundle displays the pattern offline. External audition requires the web version and an internet connection to Strudel. The project does not embed or distribute the runtime in this PR. The [official Strudel embedding guidance](https://strudel.cc/technical-manual/project-start/) describes the AGPL-3.0 terms and calls for a compatible project license for an integrated distribution. Music Universe has no declared repository license, so the PR uses the documented standalone REPL link.
