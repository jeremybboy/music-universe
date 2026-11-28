"""Run the local MDX23C DrumSep checkpoint on an existing Demucs drum stem."""
from contextlib import ExitStack
from hashlib import file_digest
import json
import os
from pathlib import Path
import resource
import signal
import sys
from tempfile import TemporaryDirectory
import time

MODEL = "aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059"
DIGESTS = {
    MODEL + ".ckpt": "d2a4aa53eb584d21eead358a4e66d1882ad182911be018f052b5da73be9096d0",
    MODEL + ".yaml": "17d1649a227f841165bdb4c11a42082898192a1ea3ceab7e7e0b9293d6589dd6",
}
NAMES = ("kick", "snare", "hihat", "cymbals", "percussion")
RATE = 48_000
MODEL_RATE = 44_100
WINDOW = 14 * RATE
OVERLAP = 2 * RATE


def progress(root, percent, stage, **details):
    temporary = root / "drum-split-progress.tmp"
    temporary.write_text(json.dumps({"percent": percent, "stage": stage, **details}), encoding="utf8")
    temporary.replace(root / "drum-split-progress.json")


def load_model(local):
    models = local / "models"
    for name, expected in DIGESTS.items():
        with (models / name).open("rb") as checkpoint:
            if file_digest(checkpoint, "sha256").hexdigest() != expected:
                raise ValueError("The MDX23C checkpoint or configuration failed verification.")
    # The pinned runner uses torch.load internally. Require tensor-only loading.
    os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] = "1"
    sys.path.insert(0, str(local / "source/src"))
    import torch
    from mdxnet_infer.inference import MDX23CInference

    torch.set_num_threads(2)
    return MDX23CInference(model_path=models / (MODEL + ".ckpt"), config_path=models / (MODEL + ".yaml"),
                           device="cpu", model_name="drumsep-6stem")


def predict_parts(model, samples):
    import numpy as np
    from scipy.signal import resample_poly

    # Preserve stereo and match the sample-rate conversion used in the A/B.
    estimated = model.separate(resample_poly(samples, 147, 160, axis=0),
                               sample_rate=MODEL_RATE, progress=False)
    output = []
    groups = (estimated["kick"], estimated["snare"], estimated["hh"], estimated["ride"] + estimated["crash"])
    for part in groups:
        part = resample_poly(part, 160, 147, axis=0)[:len(samples)]
        if part.shape != samples.shape or not np.isfinite(part).all():
            raise ValueError("MDX23C returned invalid drum audio.")
        output.append(part)
    return np.stack(output)


def split(local, root):
    started_loading = time.perf_counter()
    progress(root, 0, "Load MDX23C")
    import numpy as np
    import soundfile as sf

    model = load_model(local)
    started = time.perf_counter()
    progress(root, 0, "Separate drum parts with MDX23C")
    ready = root / "drum-parts"
    with TemporaryDirectory(prefix=".drum-split-", dir=root) as temporary:
        partial = Path(temporary) / "parts"
        partial.mkdir()
        with ExitStack() as stack:
            source = stack.enter_context(sf.SoundFile(root / "drums.wav"))
            if source.samplerate != RATE or source.channels != 2 or len(source) < 1024:
                raise ValueError("The drum stem must be stereo at 48 kHz.")
            outputs = [
                stack.enter_context(sf.SoundFile(partial / (name + ".wav"), mode="w",
                                                 samplerate=RATE, channels=2, subtype="FLOAT"))
                for name in NAMES
            ]
            offset = 0
            tail = None
            fade = np.linspace(0, 1, OVERLAP, dtype=np.float32)[None, :, None]
            while offset < len(source):
                source.seek(offset)
                clip = source.read(WINDOW, dtype="float32", always_2d=True)
                parts = predict_parts(model, clip)
                if tail is not None:
                    parts[:, :OVERLAP] = tail * (1 - fade) + parts[:, :OVERLAP] * fade
                more = offset + len(clip) < len(source)
                count = len(clip) - OVERLAP if more else len(clip)
                tail = parts[:, count:].copy() if more else None
                block = parts[:, :count]
                for track, samples in zip(outputs, block):
                    track.write(samples)
                # Retain toms and everything the other four estimates leave behind.
                outputs[-1].write(clip[:count] - block.sum(axis=0))
                offset += count
                progress(root, min(99, round(offset * 100 / len(source))), "Separate drum parts with MDX23C")

        partial.rename(ready)
    progress(root, 100, "Drum split complete", wall_s=round(time.perf_counter() - started, 3),
             startup_s=round(started - started_loading, 3),
             peak_rss_mib=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**2, 1))


def terminate(_signal, _frame):
    raise SystemExit(143)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, terminate)
    local, root = map(Path, sys.argv[1:])
    try:
        split(local, root)
    except (ImportError, FileNotFoundError):
        progress(root, 0, "Drum split failed", error="Run the MDX23C setup script for this Audio Analyst workspace.")
        raise
    except Exception as error:
        message = str(error).splitlines()[0] if str(error) else type(error).__name__
        progress(root, 0, "Drum split failed", error=message)
        raise
