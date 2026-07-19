# Controllable native operations

Version 0.3 adds job-based Android and iOS operations for progress, cooperative
cancellation, resource limits, and atomic output. The original `diff` and
`patch` promise APIs remain source compatible and do not acquire implicit
limits.

## Public API

```ts
import { startPatch } from 'react-native-bs-diff-patch';

const job = startPatch(oldPath, outputPath, patchPath, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
});

const unsubscribe = job.onProgress(({ phase, progress }) => {
  updateProgress({ phase, percent: Math.round(progress * 100) });
});

try {
  await job.result;
} finally {
  unsubscribe();
}

// From a separate UI action:
await job.cancel();
```

`startDiff(oldPath, newPath, patchPath, options?)` has the same job shape.
`job.result` resolves to `0`; `job.cancel()` is idempotent from the caller's
perspective; and `job.onProgress()` returns an unsubscribe function.

## Resource limits

`maxInputBytes` and `maxOutputBytes` must be positive safe integers when
provided. Limits are per operation and have no library default because safe
values depend on device class and the host application's memory budget.

- `maxInputBytes` checks each native input before allocating operation buffers.
- `maxOutputBytes` checks a patch's declared restored size before allocation.
- Patch generation also checks its compressed output while it is being written.
- Limit failures reject with `EINPUT_TOO_LARGE` or `EOUTPUT_TOO_LARGE`.

## Cancellation and progress

Cancellation is cooperative. The shared C core checks it during file reads,
suffix processing, compression/decompression, and output writes. A cancelled
operation rejects with `ECANCELLED`, removes its temporary output, and emits no
later progress events.

Progress is phase based and monotonic, not an ETA. Events contain the job `id`,
the `diff` or `patch` operation, a `reading`, `processing`, or `writing` phase,
and a normalized value from 0 through 1. Native delivery is rate-limited to at
most ten events per second except at phase boundaries and completion.

## Atomic output

Job operations write to an exclusively created sibling temporary file, flush
and validate it, then commit it at the destination. The destination must not
already exist, and failed, limited, or cancelled jobs do not expose a partial
output. Existing `diff` and `patch` keep their established behavior.

## Platform behavior

The job API is available on Android and iOS. React Native Web uses the binary
`diffBytes` and `patchBytes` APIs with an `AbortSignal` and byte limits instead;
calling `startDiff` or `startPatch` on Web rejects with `EUNSUPPORTED`.

The patch wire format remains `ENDSLEY/BSDIFF43`. Operation control changes
execution behavior, not patch compatibility.

## Verification

The repository verifies the controls at three levels:

1. deterministic C tests cover progress, limits, cancellation, destination
   preservation, malformed input, and temporary-file cleanup;
2. Android API 24/31 and iOS Simulator tests invoke the public JavaScript job
   facade through the New Architecture runtime;
3. React Native 0.73.11/0.74.7 compatibility fixtures compile the packaged
   native APIs, while the full RN 0.86 example supplies the current-version
   build and runtime gate.
