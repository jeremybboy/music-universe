# Music Universe packages

`.muv` v0.1.0 is a provisional format for authored, synthesized songs. The same loader handles the bundled Afterimage package and a file selected with **Open .muv**. Opening a valid song pauses playback and starts that work at bar 1. An invalid file leaves the current song and transport intact. The selected file is read locally. In the standalone Mac app, **Open .muv** uses the system file chooser.

## Build a package

Afterimage’s canonical source is [songs/afterimage](../songs/afterimage). The derived [Afterimage.muv](../songs/Afterimage.muv) is embedded in the browser and Mac players. The Mac bundle also contains a copy in `Contents/Resources/Player`.

```sh
npm run pack:muv
npm run pack:muv -- --check
npm run pack:muv -- tests/fixtures/beacon ./Beacon.muv
```

The packer validates the result, orders entries by path, and uses fixed archive timestamps. The test fixture is a four-bar synthetic signal for exercising the format.

## ZIP profile

Place `manifest.json` at the archive root. Include UTF-8 JSON event files at the relative paths declared in the manifest. This version supports the stored ZIP method (for example, `zip -0 -D -X`), with up to 16 ordinary files, 256 KiB per file, and 512 KiB total package size. The reader checks local and central headers, checksums, and relative paths in memory. It accepts plain, single-disk ZIP archives without encryption, data descriptors, ZIP64, directory entries, or archive comments. Unreferenced entries and unknown fields are rejected.

## Manifest

Use `"format": "music-universe"` and `"format_version": "0.1.0"`. The runtime uses these four separable concepts.

| Concept | Data |
| --- | --- |
| Identity | `identity` holds the work ID and title, optional artist and key, 4/4 meter, bar count, ordered sections that cover the loop, optional per-bar chord labels, and optional descriptions of fixed anchors. |
| Expressions | Each entry in `expressions` gives a stable ID, display label, BPM, default mood and energy, optional texture and energy labels, and a path to its event file. `default_expression` selects the initial one. |
| Possibilities | `roles` declares usable instrument groups. `possibilities` permits specific moods, controls and directed transitions. |
| Realization | The player tracks the selected expression, actual tempo, mood, energy, active layers, bar, and any queued transition. It is runtime state. |

v0.1 uses the existing expression IDs `intimate`, `rnb`, and `club` for browser styling, synth mix profiles, and text commands. A song can declare any nonempty subset and use its own labels, tempos, and musical data. Supported roles are `drums`, `bass`, `keys`, `lead`, and `pad`. The playable loop is 1–32 bars and the BPM range is 30–240 quarter-note beats per minute. Sections use one-based `start_bar` and a positive `bars` count.

Supported listener controls are `mood-articulation`, `energy-shaping`, and `layer-mix`. Omit `transforms` or `transitions` to disable those changes. When omitted, `moods` defaults to the built-in vocabulary, `transition_bars` defaults to 2, and optional labels stay absent. The transport applies allowed intra-song changes at a two-bar boundary while playing. The offline text parser checks the same permissions as the buttons.

## Event data

Each event asset is an array with one array of notes per bar, in timeline order. A bar may contain at most 64 notes. A note uses `at` as its zero-based beat offset inside the bar, `length` in quarter-note beats, `pitch` as MIDI note number 0–127, and `velocity` as a normalized value above zero and up to 1. The note names a declared `instrument` and a built-in `voice` (`felt`, `rhodes`, `pluck`, `sub`, `round`, `drive`, `air`, `kick`, `snare`, or `hat`). Optional `pan` ranges from −1 to 1.

The renderer optionally uses `groovy_at` for onset in Groovy mood and `short_length` for duration in Groovy or Energetic mood. It adds `energy_velocity × energy` to the authored base velocity. An optional `energy_gate` with one of `at_least`, `above`, or `at_most` includes the event only on the specified side of the normalized threshold. Afterimage uses these operations to retain its timing, articulation, chord voicing, and hat patterns across control changes. Synthesis, output mix profiles, and the timing clock are provided by the player.

Future asset types may include recorded WAV/MP3 stems and standard MIDI. The v0.1 reader accepts only the JSON profile described above.
