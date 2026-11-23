# Player architecture

`frontend/` owns the controls and reads playback snapshots. `music/state.ts` validates patches from both the controls and the offline intent parser. `music/composition.ts` renders the next authored bar of the active song against the chosen world, mood, energy, and enabled layers. `music/transport.ts` is the authority on when that bar sounds.

## Portable song data

The [provisional .muv format](muv-format.md) stores the work identity, expressions, permitted changes, and JSON note events. `music/universe/` validates the archive and its data before the transport can replace the active song. Listen and Discover display the same song and transport snapshot. Both view controls and text prompts use the same permission checks and scheduler.

## Afterimage

Afterimage uses eight bars in 4/4, in A minor, over Am–F–C–G twice. Each world keeps the lead pitches and their order. Intimate plays staggered, soft keys and a sparse pulse. R&B revoices the groove around a syncopated bass and backbeat. Club uses a floor kick, repeated bass notes, and brighter electronic voices. Mood modifies note articulation and filter brightness, while energy adjusts voicing and attack detail. The five layers contribute independently to the mix. Changing world loads its default mood and energy and preserves layer toggles.

The composition consists of original note and pattern data. Oscillators and short synthetic noise produce the sounds in the browser.

## Timing

The transport schedules bars against `AudioContext.currentTime`. It wakes every 21 ms and commits a bar when its start falls within 105 ms of the audio clock. A new request replaces the queued plan until that bar has been scheduled. A request made after commitment is eligible for the following two-bar boundary. At a switch, the new tempo uses the same absolute beat and the arrangement buses crossfade over 76 ms. The interface shows the actual scheduled bar in the eight-bar loop.

Pause fades the current buses, preserves the fractional beat, and applies any pending config at rest. Resume begins from that beat and schedules upcoming events. Notes that started before the saved beat decay on pause and resume from their next authored onset. Keep the player in a foreground tab for reliable scheduling.

## Audio and visuals

The master gain and compressor feed the analyser and speakers. Canvas reads the output RMS and low, mid and high bands. Rising bass energy triggers brighter accents. Audio level drives displacement and motion, while the active arrangement sets the palette and layer count sets strand density. The loop stops drawing continuously during pause and under reduced motion preferences.

## Text intent

The local parser accepts a world, a mood, an energy percentage or relative change, and named layer commands. `less percussive` mutes drums. Unsupported phrases are reported without applying a partial result. A future intent provider can implement the `IntentAdapter` type and pass its patch through the same validator.

## Mac app

`macos/App.swift` hosts the same player in a resizable AppKit window with WebKit. The launcher opens the bundled player page and restricts navigation to that page. `scripts/build-macos.mjs` packages the production UI as a local HTML, CSS and classic JavaScript bundle for WebKit. `macos/MakeIcon.swift` renders the MUSIC UNIVERSE icon at the sizes used by Finder and the Dock.
