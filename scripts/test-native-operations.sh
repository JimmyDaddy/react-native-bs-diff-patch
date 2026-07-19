#!/bin/sh
set -eu

repository_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary_directory=$(mktemp -d)
trap 'rm -rf "$temporary_directory"' EXIT INT TERM

cc -std=c11 -O2 -Wall -Wextra -Werror -Wno-implicit-fallthrough \
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
