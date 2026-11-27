"""Run the installed Audio Analyst and retain full-length audition files locally."""
import json
import subprocess
import sys
from pathlib import Path

workspace, source, output = map(Path, sys.argv[1:4])
tools = workspace / "work/audio-analyst"
sys.path.insert(0, str(workspace / "outputs/audio-analyst"))

steps = ("Decode the full track", "Tempo and beats", "Key", "Separate the full track",
         "Candidate notes", "Timbre", "CLAP2", "Compare the stems", "Save the report")


def progress(step, *, error=None):
    status = {"percent": round(step * 100 / len(steps)), "stage": steps[step] if step < len(steps) else "Complete"}
    if error:
        status["error"] = error
    temp = output / "progress.tmp"
    temp.write_text(json.dumps(status), encoding="utf8")
    temp.replace(output / "progress.json")


def run():
    progress(0)
    import audio_analyst as analyst
    import numpy as np
    from scipy.io.wavfile import write

    rate = analyst.features.SAMPLE_RATE
    limit = 15 * 60
    decoded = subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
        "-i", str(source), "-t", str(limit + 1), "-map", "0:a:0",
        "-ac", "2", "-ar", str(rate), "-f", "f32le", "pipe:1",
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if decoded.returncode:
        raise ValueError("FFmpeg could not decode the selected audio file.")
    audio = np.frombuffer(decoded.stdout, dtype="<f4").reshape(-1, 2)
    if len(audio) < rate // 4 or not np.isfinite(audio).all():
        raise ValueError("The track must contain at least 0.25 seconds of valid audio.")
    if len(audio) > limit * rate:
        raise ValueError("Choose a track up to 15 minutes.")
    def save_audio(name, data):
        path = output / (name + ".tmp")
        write(path, rate, data)
        path.replace(output / (name + ".wav"))

    save_audio("mix", audio)
    excerpt = audio[:24 * rate]
    progress(1)

    # Run the regular analyzer on the excerpt. Reuse full-track separation for that excerpt.
    analyst.features.decode = lambda path, start, duration: excerpt
    separate = analyst.models.separate

    def separate_full(_excerpt, checkpoint, threads):
        evidence, stems = separate(audio, checkpoint, threads)
        for name in ("drums", "bass", "other", "vocals"):
            save_audio(name, stems[name])
        return evidence, {name: data[:len(excerpt)] for name, data in stems.items()}

    analyst.models.separate = separate_full
    timed = analyst.timed
    stages = {"key_dsp": 2, "demucs": 3, "basic_pitch": 4, "timbre": 5, "clap2": 6, "drums_timbre": 7}

    def report_stage(measurements, name, operation, optional=False):
        if name in stages:
            progress(stages[name])
        return timed(measurements, name, operation, optional)

    analyst.timed = report_stage
    checkpoints = tools / "checkpoints"
    sys.argv = [sys.argv[0], "analyze", str(source), "--duration", "24", "--threads", "2"]
    options = {
        "--beat-model": checkpoints / "beat-this-small0.ckpt",
        "--pitch-model": tools / "deps/basic_pitch/saved_models/icassp_2022/nmp.onnx",
        "--semantic-model": checkpoints / "clap2-xxs-verified",
        "--demucs-model": checkpoints / "955717e8-8726e21a.th",
    }
    for flag, path in options.items():
        if path.exists():
            sys.argv.extend((flag, str(path)))
    args = analyst.cli()
    args.stem_audit = args.demucs_model is not None
    report = analyst.analyse(args)
    progress(8)
    (output / "report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf8")
    progress(len(steps))


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        message = str(error).splitlines()[0] if str(error) else type(error).__name__
        if isinstance(error, ImportError):
            message = "Audio Analyst dependencies are missing from the selected installation."
        progress(0, error=message)
        raise
