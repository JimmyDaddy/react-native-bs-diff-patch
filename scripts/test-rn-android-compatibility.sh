#!/bin/sh

set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <react-native-version> [old|new]" >&2
  exit 2
fi

react_native_version="$1"
architecture="${2:-new}"
repository_directory=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
react_native_minor=$(printf '%s\n' "$react_native_version" | cut -d. -f2)

if [ "$react_native_minor" -ge 86 ]; then
  kotlin_version=2.1.20
else
  kotlin_version=1.9.22
fi

"$repository_directory/example/android/gradlew" \
  -p "$repository_directory/compatibility/android-api" \
  --no-daemon \
  --stacktrace \
  -PreactNativeVersion="$react_native_version" \
  -PkotlinVersion="$kotlin_version" \
  -Parchitecture="$architecture" \
  clean compileReleaseKotlin
