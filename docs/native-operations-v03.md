# Native operations roadmap for 0.3

Version 0.2 established background execution, deterministic cross-platform
patches, malformed-input cleanup, and browser-side cancellation and limits.
The 0.3 native work will add the same production controls without changing the
existing `diff` and `patch` signatures.

This is an implementation contract. Public names remain provisional until the
0.3 beta, but the behavior and error model below are the acceptance criteria.

## Public shape

The existing promise APIs stay source compatible. A job API is added for
callers that need limits, cancellation, or progress:

```ts
type NativeOperationOptions = {
  maxInputBytes?: number;
  maxOutputBytes?: number;
};

type NativeOperationProgress = {
  id: string;
  operation: 'diff' | 'patch';
  phase: 'reading' | 'processing' | 'writing';
  progress: number; // monotonic, from 0 through 1
};

const job = startPatch(oldFile, newFile, patchFile, options);
const unsubscribe = job.onProgress((event) => updateUi(event.progress));
await job.cancel();
await job.result;
unsubscribe();
```

`diff` and `patch` continue to use the same serialized native worker. They do
not acquire implicit size limits, so upgrading does not reject an operation
that previously succeeded.

## Resource limits

- Validate every numeric limit in JavaScript and native code as a positive,
  safe integer.
- Check input file sizes before allocating operation buffers.
- Check the patch header before allocating restored output.
- Enforce generated-output limits while writing, not only after completion.
- Reject with `EINPUT_TOO_LARGE` or `EOUTPUT_TOO_LARGE`; include the configured
  limit and observed byte count in native error metadata.

Limits are per operation. The package will not choose a universal default
because safe values depend on device class and the host application's memory
budget.

## Cancellation and progress

Cancellation is cooperative. The shared C core receives a callback context and
checks it during file reads, suffix processing, compression/decompression, and
output writes. A cancelled operation rejects with `ECANCELLED` and never emits
another progress event.

Progress is phase based and monotonic. It is not an ETA: suffix sorting and
compression are data dependent. Native code rate-limits events to avoid
crossing the React Native bridge more than ten times per second.

## Atomic output

0.2 already removes an output created by a failed operation. In 0.3, job-based
operations strengthen this to an atomic commit:

1. create a unique sibling temporary file with exclusive creation;
2. write, flush, close, and validate the result;
3. rename the temporary file to the requested output path;
4. remove the temporary file on error or cancellation.

The destination must not exist. Rename must stay on the same filesystem; the
library will not silently fall back to a copy.

## Delivery sequence

1. Add cancellable/limited C stream callbacks and deterministic C tests.
2. Add Android and iOS job registries, event delivery, and cleanup tests.
3. Expose the TypeScript job facade while keeping `diff` and `patch` unchanged.
4. Run API 24 Android and iOS simulator cancellation/resource-limit tests.
5. Publish a 0.3 beta, validate registry consumers, then promote the stable
   release without changing patch bytes.

The patch wire format remains `ENDSLEY/BSDIFF43`; 0.3 changes operation control,
not compatibility.
