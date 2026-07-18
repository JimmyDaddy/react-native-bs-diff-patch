#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
emcc_bin="${EMCC:-emcc}"

if ! command -v "${emcc_bin}" >/dev/null 2>&1; then
  echo "Emscripten compiler not found. Set EMCC or add emcc to PATH." >&2
  exit 1
fi

"${emcc_bin}" \
  "${repo_dir}/cpp/bsdiff.c" \
  "${repo_dir}/cpp/bspatch.c" \
  "${repo_dir}/cpp/bzlib/blocksort.c" \
  "${repo_dir}/cpp/bzlib/bzlib.c" \
  "${repo_dir}/cpp/bzlib/compress.c" \
  "${repo_dir}/cpp/bzlib/crctable.c" \
  "${repo_dir}/cpp/bzlib/decompress.c" \
  "${repo_dir}/cpp/bzlib/huffman.c" \
  "${repo_dir}/cpp/bzlib/randtable.c" \
  -I"${repo_dir}/cpp" \
  -I"${repo_dir}/cpp/bzlib" \
  -O3 \
  -flto \
  --no-entry \
  -sASSERTIONS=0 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sENVIRONMENT=web,worker,node \
  -sEXPORTED_FUNCTIONS='["_bsDiffFile","_bsPatchFile"]' \
  -sEXPORTED_RUNTIME_METHODS='["FS","ccall"]' \
  -sEXPORT_ES6=1 \
  -sFILESYSTEM=1 \
  -sMODULARIZE=1 \
  -sNO_EXIT_RUNTIME=1 \
  -sSINGLE_FILE=1 \
  -o "${repo_dir}/web/bsdiffpatch.mjs"
