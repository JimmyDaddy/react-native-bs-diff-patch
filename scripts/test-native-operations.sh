#!/bin/sh
set -eu

repository_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary_directory=$(mktemp -d)
trap 'rm -rf "$temporary_directory"' EXIT INT TERM

feature_test_macro=-D_POSIX_C_SOURCE=200809L
if [ "$(uname -s)" = "Darwin" ]; then
  feature_test_macro=-D_DARWIN_C_SOURCE
fi

cc -std=c11 "$feature_test_macro" -O2 -Wall -Wextra -Werror \
  -Wno-implicit-fallthrough \
  -Wno-unused-parameter \
  -I "$repository_directory/cpp" \
  "$repository_directory/cpp/tests/native_operations_test.c" \
  "$repository_directory/cpp/bsdiff.c" \
  "$repository_directory/cpp/bspatch.c" \
  "$repository_directory/cpp/bzlib/blocksort.c" \
  "$repository_directory/cpp/bzlib/bzlib.c" \
  "$repository_directory/cpp/bzlib/compress.c" \
  "$repository_directory/cpp/bzlib/crctable.c" \
  "$repository_directory/cpp/bzlib/decompress.c" \
  "$repository_directory/cpp/bzlib/huffman.c" \
  "$repository_directory/cpp/bzlib/randtable.c" \
  -o "$temporary_directory/native-operations-test"

"$temporary_directory/native-operations-test"
