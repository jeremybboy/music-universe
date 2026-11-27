# Song Analysis

## Analyze and audition a recording on Mac

In the standalone app, choose **Song Analysis → Connect Audio Analyst** and select the trusted local Audio Analyst handoff workspace. It must contain `work/audio-analyst/runtime/bin/python`, the installed dependencies and checkpoints in `work/audio-analyst`, and the analyzer modules in `outputs/audio-analyst`. Install FFmpeg so it is available in `/opt/homebrew/bin`, `/usr/local/bin`, or `/usr/bin`. The app remembers the selected workspace on this Mac.

Choose a supported audio file of up to 512 MiB or 15 minutes. Progress shows the current operation and the share of analysis stages crossed, including optional stages the installation skips. Demucs separates the whole track when its checkpoint is installed. Tempo, key, notes, timbre, and stem comparison evidence cover up to the first 24 seconds. **Song description** uses the local CLAP2 checkpoint to compare genres, moods, energy, groove, instruments, and production traits in up to 32 eight-second windows spread from the beginning to the end. Select one or more stem groups, such as **Drums** and **Bass**, and use **Play recording** to hear them together. **Original** and **Stem mix** switch sources at the same playhead during playback, and the selected stem groups stay available for comparison. Stems are model estimates. The recording and generated files stay on this computer, in a temporary working directory for the session. One job can run at a time and can be cancelled.

The description ranks an expandable inventory within each category by average cosine similarity. Open a category to see all its comparisons or play the excerpt with the strongest match for a candidate. The report records every prompt, sampled timestamp, and score. Treat production techniques, moods, and instruments as interpretations of the sound. Confirm them by listening.

The web app can preview a browser-decodable recording from a local file and import an existing report. The public static build has no analysis service.

## Import a completed report

Use **Song Analysis → Import analysis report** to open an Audio Analyst schema v1 JSON file up to 2 MiB. Review the excerpt and confirm the song or expression explicitly. The app keeps one report per association for the loaded song instance, in session memory. An invalid import keeps the previous report and playback. Reloading the app clears the session.

Reports retain the original JSON, including method and model metadata, every prompt and cosine score, and the embedding when supplied. **Download report JSON** returns the retained report in browsers. The offline Mac app supports local import and inspection. Keep the original JSON file for reuse on macOS. The browser and Mac app do not need a running analyzer to import a report.

## Run Audio Analyst locally

In an existing Audio Analyst checkout with its local launcher, replace the placeholder paths and choose a short section:

```sh
analyst="/path/to/audio-analyst/run"
"$analyst" analyze "/path/to/source.wav" \
  --start 12 --duration 8 --threads 2 --out "/path/to/report.json"
```

For an opt-in comparison using already installed CLAP2 and Demucs checkpoints:

```sh
"$analyst" analyze "/path/to/source.wav" \
  --start 12 --duration 8 --threads 2 --semantic-seconds 8 \
  --semantic-model "/path/to/clap2-xxs-verified" \
  --demucs-model "/path/to/955717e8-8726e21a.th" --stem-audit \
  --out "/path/to/model-report.json"
```

The analyzer exits after writing JSON. Supply `--beat-model` and/or `--pitch-model` with local checkpoints when you want timestamped beat or note candidates. The report shows evidence for an excerpt. CLAP2 cosine scores are comparisons, and Demucs groups are estimates that can contain bleed. Keep private reports, source recordings, and checkpoints outside this repository. The test fixture was produced by the CLI from a generated stereo pulse and tones.
