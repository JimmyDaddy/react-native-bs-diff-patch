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
  "${repo_dir}/cpp/bsdiff40_converter.c" \
  "${repo_dir}/cpp/bspatch.c" \
  "${repo_dir}/cpp/bspatch_streaming.c" \
  "${repo_dir}/web/progress_bridge.c" \
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
  -lnodefs.js \
  -lworkerfs.js \
  --no-entry \
  -sASSERTIONS=0 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sENVIRONMENT=web,worker,node \
  -sEXPORTED_FUNCTIONS='["_bsDiffFile","_bsPatchFile","_bsConvertBsdiff40File","_bsDiffFileWithProgress","_bsPatchFileWithProgress","_bsDiffFileWithProgressAndLimits","_bsPatchFileWithProgressAndLimits"]' \
  -sEXPORTED_RUNTIME_METHODS='["FS","NODEFS","WORKERFS","ccall"]' \
  -sEXPORT_ES6=1 \
  -sFILESYSTEM=1 \
  -sMODULARIZE=1 \
  -sNO_EXIT_RUNTIME=1 \
  -sSINGLE_FILE=1 \
  -o "${repo_dir}/web/bsdiffpatch.mjs"

"${emcc_bin}" \
  "${repo_dir}/cpp/bsdiff.c" \
  "${repo_dir}/cpp/bsdiff40_converter.c" \
  "${repo_dir}/cpp/bspatch.c" \
  "${repo_dir}/cpp/bspatch_streaming.c" \
  "${repo_dir}/web/progress_bridge.c" \
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
  -lworkerfs.js \
  --no-entry \
  --pre-js "${repo_dir}/web/minimal-runtime-pre.js" \
  -sASSERTIONS=0 \
  -sMINIMAL_RUNTIME=1 \
  -sEXPORT_ALL=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sENVIRONMENT=web,worker \
  -sEXPORTED_FUNCTIONS='["_bsDiffFile","_bsPatchFile","_bsConvertBsdiff40File","_bsDiffFileWithProgress","_bsPatchFileWithProgress","_bsDiffFileWithProgressAndLimits","_bsPatchFileWithProgressAndLimits"]' \
  -sEXPORTED_RUNTIME_METHODS='["FS","WORKERFS","ccall"]' \
  -sEXPORT_ES6=1 \
  -sFILESYSTEM=1 \
  -sMODULARIZE=1 \
  -sNO_EXIT_RUNTIME=1 \
  -sSINGLE_FILE=1 \
  -o "${repo_dir}/web/bsdiffpatch.browser.mjs"
