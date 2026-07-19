#!/bin/sh

set -eu

repository_directory=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
temporary_directory=$(mktemp -d)
fuzz_runs="${FUZZ_RUNS:-5000}"
compiler="${CC:-clang}"

cleanup() {
  rm -rf "$temporary_directory"
}
trap cleanup EXIT INT TERM

if "$compiler" \
  -std=c11 \
  -g \
  -O1 \
  -fno-omit-frame-pointer \
  -fsanitize=fuzzer,address,undefined \
  -I"$repository_directory/cpp" \
  "$repository_directory/cpp/bspatch.c" \
  "$repository_directory/cpp/fuzz/bspatch_fuzzer.c" \
  "$repository_directory/cpp/bzlib/blocksort.c" \
  "$repository_directory/cpp/bzlib/bzlib.c" \
  "$repository_directory/cpp/bzlib/compress.c" \
  "$repository_directory/cpp/bzlib/crctable.c" \
  "$repository_directory/cpp/bzlib/decompress.c" \
  "$repository_directory/cpp/bzlib/huffman.c" \
  "$repository_directory/cpp/bzlib/randtable.c" \
  -o "$temporary_directory/bspatch-fuzzer" 2>/dev/null; then
  "$temporary_directory/bspatch-fuzzer" \
    -runs="$fuzz_runs" \
    -max_len=512 \
    -print_final_stats=1
else
  "$compiler" \
    -std=c11 \
    -g \
    -O1 \
    -fno-omit-frame-pointer \
    -DBSDIFFPATCH_STANDALONE_FUZZ=1 \
    -fsanitize=address,undefined \
    -I"$repository_directory/cpp" \
    "$repository_directory/cpp/bspatch.c" \
    "$repository_directory/cpp/fuzz/bspatch_fuzzer.c" \
    "$repository_directory/cpp/bzlib/blocksort.c" \
    "$repository_directory/cpp/bzlib/bzlib.c" \
    "$repository_directory/cpp/bzlib/compress.c" \
    "$repository_directory/cpp/bzlib/crctable.c" \
    "$repository_directory/cpp/bzlib/decompress.c" \
    "$repository_directory/cpp/bzlib/huffman.c" \
    "$repository_directory/cpp/bzlib/randtable.c" \
    -o "$temporary_directory/bspatch-fuzzer"
  "$temporary_directory/bspatch-fuzzer" "$fuzz_runs"
fi
