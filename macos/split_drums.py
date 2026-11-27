"""Run the local Inverse Drum Machine checkpoint on an existing Demucs drum stem."""
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

CHECKPOINT = "val-epoch=518-global_step=0.ckpt"
DIGESTS = {
    CHECKPOINT: "5856a9bee7c6d503842795756d238dc8470f6f3e010e9e4f33ede0362850cb4c",
    "model.yaml": "2300e60bfaa8c4c4756568d8ede8992d2e56231b2a519acf30fda1d1bb36f2e6",
}
NAMES = ("kick", "snare", "hihat", "percussion")
RATE = 48_000
MODEL_RATE = 44_100
WINDOW = 6 * RATE
OVERLAP = RATE // 4


def progress(root, percent, stage, **details):
    temporary = root / "drum-split-progress.tmp"
    temporary.write_text(json.dumps({"percent": percent, "stage": stage, **details}), encoding="utf8")
    temporary.replace(root / "drum-split-progress.json")


def load_model(local):
    checkpoints = local / "source/pretrained/idm-44-train-kits/checkpoints"
    for name, expected in DIGESTS.items():
        with (checkpoints / name).open("rb") as checkpoint:
            if file_digest(checkpoint, "sha256").hexdigest() != expected:
                raise ValueError("The Inverse Drum Machine checkpoint or configuration failed verification.")
    sys.path.insert(0, str(local / "source"))
    import hydra
    from omegaconf import OmegaConf
    import torch

    torch.set_num_threads(2)
    model = hydra.utils.instantiate(OmegaConf.load(checkpoints / "model.yaml"))
    weights = torch.load(checkpoints / CHECKPOINT, map_location="cpu", weights_only=True)
    model.load_state_dict(weights.get("state_dict", weights))
    return model.eval()


def predict_parts(model, samples):
    import torch
    import torchaudio.functional as audio
    from idm.synthesis_conditioning.embedding import get_conditioning_vector

    stereo = torch.from_numpy(samples.T.copy())
    mono = audio.resample(stereo.mean(dim=0, keepdim=True), RATE, MODEL_RATE)
    encoded = model.encoder(mono.unsqueeze(0))
    # The pinned decoder assumes CUDA when passed a two-dimensional kit embedding.
    encoded["embeddings"] = get_conditioning_vector(
        n_classes=len(model.train_classes), embedding=encoded["embeddings"], batch_size=1, device=mono.device
    )
    estimated = model.decoder(**encoded, extra_returns=["stems"])["stems"][0, :, :mono.shape[-1]]
    rendered = audio.resample(estimated, MODEL_RATE, RATE)
    window = torch.hann_window(1024)
    controls = torch.stft(rendered, 1024, 256, window=window, return_complex=True).abs().square()
    total = controls.sum(dim=0).clamp_min(1e-12)
    source = torch.stft(stereo, 1024, 256, window=window, return_complex=True)
    classes = model.train_classes
    masks = torch.stack(
        [controls[classes.index("KD")], controls[classes.index("SD")],
         controls[classes.index("HH_CHH")] + controls[classes.index("HH_OHH")]]
    ) / total
    length = stereo.size(1)
    # Resampling can produce one extra frame. Keep the mix spectrum and its original length.
    tf_frames = source.size(-1)
    selected = (source[None] * masks[:, None, :, :tf_frames]).flatten(0, 1)
    return torch.istft(selected, 1024, 256, window=window, length=length).reshape(3, 2, length).numpy()


def split(local, root):
    started_loading = time.perf_counter()
    progress(root, 0, "Load Inverse Drum Machine")
    os.environ.setdefault("MPLCONFIGDIR", str(local / "mpl"))
    import numpy as np
    import soundfile as sf
    import torch

    model = load_model(local)
    torch.manual_seed(0)
    started = time.perf_counter()
    ready = root / "drum-parts"
    with TemporaryDirectory(prefix=".drum-split-", dir=root) as temporary:
        partial = Path(temporary) / "parts"
        partial.mkdir()
        with ExitStack() as stack, torch.inference_mode():
            source = stack.enter_context(sf.SoundFile(root / "drums.wav"))
            if source.samplerate != RATE or source.channels != 2 or len(source) < 1024:
                raise ValueError("The drum stem must be stereo at 48 kHz.")
            outputs = [stack.enter_context(sf.SoundFile(partial / (name + ".wav"), mode="w",
                      samplerate=RATE, channels=2, subtype="FLOAT")) for name in NAMES]
            offset = 0
            tail = None
            fade = np.linspace(0, 1, OVERLAP, dtype=np.float32)
            while offset < len(source):
                source.seek(offset)
                clip = source.read(WINDOW, dtype="float32", always_2d=True)
                parts = predict_parts(model, clip)
                if tail is not None:
                    parts[..., :OVERLAP] = tail * (1 - fade) + parts[..., :OVERLAP] * fade
                more = offset + len(clip) < len(source)
                count = len(clip) - OVERLAP if more else len(clip)
                tail = parts[..., count:].copy() if more else None
                block = parts[..., :count].transpose(0, 2, 1)
                for track, samples in zip(outputs, block):
                    track.write(samples)
                outputs[-1].write(clip[:count] - block.sum(axis=0))
                offset += count
                progress(root, min(99, round(offset * 100 / len(source))), "Separate drum parts")

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
    except ImportError:
        progress(root, 0, "Drum split failed", error="Run the Inverse Drum Machine setup script for this workspace.")
        raise
    except Exception as error:
        message = str(error).splitlines()[0] if str(error) else type(error).__name__
        progress(root, 0, "Drum split failed", error=message)
        raise
