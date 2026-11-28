#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  printf 'Usage: sh scripts/setup-mdx.sh /path/to/audio-analyst-workspace /path/to/drumsep-weights-directory\n' >&2
  exit 2
fi

runtime=$(cd "$1/work/audio-analyst" && pwd)
weights=$(cd "$2" && pwd)
python="$runtime/runtime/bin/python"
local="$runtime/mdx-local"
commit=cb4779eedeca4f55ba498df8e234e2b5f4b90aaf
model=aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059
if [ ! -x "$python" ]; then
  printf 'Set up the Audio Analyst Python runtime first.\n' >&2
  exit 1
fi

(cd "$weights" && /usr/bin/shasum -a 256 -c <<EOF
d2a4aa53eb584d21eead358a4e66d1882ad182911be018f052b5da73be9096d0  $model.ckpt
17d1649a227f841165bdb4c11a42082898192a1ea3ceab7e7e0b9293d6589dd6  $model.yaml
EOF
)
mkdir -p "$local/models"
if [ ! -d "$local/source/.git" ]; then
  git clone --no-checkout https://github.com/openmirlab/mdxnet-infer.git "$local/source"
fi
if [ "$(git -C "$local/source" rev-parse HEAD)" != "$commit" ] || [ ! -f "$local/source/src/mdxnet_infer/inference.py" ]; then
  git -C "$local/source" checkout --detach "$commit"
fi
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$local/source/src:$runtime/deps" "$python" -c \
  'import librosa, numpy, requests, soundfile, torch, tqdm, yaml; from scipy.signal import resample_poly; from mdxnet_infer.inference import MDX23CInference'

if [ "$weights" != "$local/models" ]; then
  cp "$weights/$model.ckpt" "$weights/$model.yaml" "$local/models/"
fi
printf 'MDX23C is ready in the Audio Analyst workspace.\n'
