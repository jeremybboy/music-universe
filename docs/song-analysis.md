# Song Analysis

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
