#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <react-native-version>" >&2
  exit 2
fi

react_native_version="$1"
repository_directory=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
temporary_directory=$(mktemp -d)
consumer_directory="$temporary_directory/consumer"

cleanup() {
  rm -rf "$temporary_directory"
}
trap cleanup EXIT INT TERM

case "$react_native_version" in
  0.73.*)
    react_version=18.2.0
    cli_version=12.3.7
    ;;
  0.74.*)
    react_version=18.2.0
    cli_version=13.6.9
    ;;
  0.86.*)
    react_version=19.2.3
    cli_version=20.2.0
    ;;
  *)
    echo "Unsupported React Native compatibility fixture: $react_native_version" >&2
    exit 2
    ;;
esac

mkdir -p "$consumer_directory/ios"
cp -R "$repository_directory/example/ios/BsDiffPatchExample.xcodeproj" "$consumer_directory/ios/"
cp -R "$repository_directory/example/ios/BsDiffPatchExample" "$consumer_directory/ios/"
cp "$repository_directory/compatibility/ios-api/Podfile" "$consumer_directory/ios/Podfile"
cp "$repository_directory/compatibility/ios-api/package.json" "$consumer_directory/package.json"

npm install \
  --prefix "$consumer_directory" \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  --save-exact \
  "$repository_directory" \
  "react@$react_version" \
  "react-native@$react_native_version" \
  "@react-native-community/cli@$cli_version" \
  "@react-native-community/cli-platform-ios@$cli_version"

(
  cd "$consumer_directory/ios"
  RCT_NEW_ARCH_ENABLED=1 \
    BUNDLE_GEMFILE="$repository_directory/example/Gemfile" \
    bundle exec pod install

  build_log="$temporary_directory/xcodebuild.log"
  if ! xcodebuild \
      -project Pods/Pods.xcodeproj \
      -scheme react-native-bs-diff-patch \
      -configuration Release \
      -sdk iphonesimulator \
      -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath "$temporary_directory/derived-data" \
      ARCHS=arm64 \
      CODE_SIGNING_ALLOWED=NO \
      ONLY_ACTIVE_ARCH=YES \
      build >"$build_log" 2>&1; then
    tail -n 200 "$build_log" >&2
    exit 1
  fi
  tail -n 20 "$build_log"
)
