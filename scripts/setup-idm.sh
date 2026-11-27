#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf 'Usage: sh scripts/setup-idm.sh /path/to/audio-analyst-workspace\n' >&2
  exit 2
fi

runtime=$(cd "$1/work/audio-analyst" && pwd)
python="$runtime/runtime/bin/python"
local="$runtime/idm-local"
commit=456656868538205ef756912c7cf5b0fd936de8af
if [ ! -x "$python" ]; then
  printf 'Set up the Audio Analyst Python runtime first.\n' >&2
  exit 1
fi

mkdir -p "$local"
if [ ! -d "$local/source/.git" ]; then
  git clone https://github.com/bernardo-torres/inverse-drum-machine.git "$local/source"
fi
if [ "$(git -C "$local/source" rev-parse HEAD)" != "$commit" ]; then
  git -C "$local/source" checkout --detach "$commit"
fi
"$python" -m pip --disable-pip-version-check install --target "$local/deps" --no-deps \
  'hydra-core==1.3.2' 'antlr4-python3-runtime==4.9.3' 'rootutils==1.0.7' 'auraloss==0.4.0'
