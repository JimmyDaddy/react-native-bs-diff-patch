#!/bin/sh

set -eu

api_level="${1:?Usage: run-android-runtime-test.sh <api-level>}"

cd example/android

run_runtime_test() {
  ./gradlew :app:connectedReleaseAndroidTest \
    --stacktrace \
    -PnewArchEnabled=true \
    -PreactNativeArchitectures=x86_64
}

if run_runtime_test; then
  exit 0
fi

if [ "$api_level" -ne 24 ]; then
  exit 1
fi

echo '::warning::API 24 emulator failed; rebooting it before one retry.'
adb reboot
sleep 5
adb wait-for-device

boot_attempt=0
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = '1' ]; do
  boot_attempt=$((boot_attempt + 1))
  if [ "$boot_attempt" -ge 90 ]; then
    echo 'API 24 emulator did not finish rebooting within 180 seconds.' >&2
    exit 1
  fi
  sleep 2
done

sleep 5
run_runtime_test
