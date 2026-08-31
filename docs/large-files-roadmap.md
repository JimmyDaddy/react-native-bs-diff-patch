# Large-file roadmap

This document defines how the project will evaluate larger inputs, expose
honest progress, and investigate streaming without weakening patch
compatibility. It is a feasibility and measurement plan, not a promise that
every browser or mobile device can process a particular file size.

## Current constraints

The current diff algorithm needs random access to the complete old and new
inputs while building and traversing its suffix array. Native calls therefore
operate on file paths but still allocate memory proportional to the input. The
Web implementation still transfers typed-array inputs into a Worker and
WebAssembly linear memory; `Blob`/`File` inputs avoid the extra main-thread copy
through WORKERFS. Node release tools mount host paths through NODEFS.

Patch application now reads the old file and compressed patch in 64 KiB
chunks and writes a sibling temporary output incrementally. Web still returns a
complete `Uint8Array`, so the browser boundary materializes the final result
even though the C core no longer allocates complete old and output buffers.

## Measurement matrix

The default 1, 10, and 50 MiB benchmarks remain the inexpensive trend line.
The explicit large-file profile uses deterministic 16, 64, and 128 MiB inputs
with one changed byte per 4 KiB:

```sh
BENCHMARK_OUTPUT=/tmp/web-large.json yarn benchmark:large:web
BENCHMARK_OUTPUT=/tmp/native-large.json yarn benchmark:large:native
```

Each size runs in a fresh process so peak resident memory is comparable. Record
the runtime, diff and patch duration, patch size, round-trip result, and peak
resident memory. The Web report also records live external and ArrayBuffer
memory after the round trip. Compare only runs from similar hardware and
toolchains; shared-runner numbers are diagnostic artifacts, not PR thresholds.
The large profiling commands preserve per-size failures in the JSON report and
complete the remaining samples; a recorded report is not itself evidence that
all sizes passed. Default benchmarks still exit unsuccessfully on any failure.

The profiling run passes when every requested size either completes a verified
round trip within the host's documented memory budget or fails with a defined
resource error. A crash, leaked temporary output, corrupted result, or silent
fallback is a failure. Results do not imply support above the measured size or
on lower-memory devices.

The initial Apple M3 Pro / Node 22 record is checked in under `benchmarks/`.
Native completed 128 MiB with approximately 2.37 GiB peak RSS. Web completed
64 MiB with approximately 2.09 GiB peak RSS, while 128 MiB exhausted the
WebAssembly memory budget. Web classifies that failure as `ERESOURCE`; the
project still does not claim 128 MiB Web diff support.

## Progress semantics

Progress must be produced by real algorithm checkpoints, never a timer or an
animation that guesses completion. Cross-platform jobs use these stages:

- `reading`: validating inputs and loading the data required by the core.
- `processing`: suffix-array/diff work or patch reconstruction.
- `writing`: persisting and atomically committing native output; Web completes
  this stage when the result buffer is ready to transfer.

Native and Web jobs expose these stages. Web progress travels from instrumented
C checkpoints through WebAssembly and Worker messages; no timer or synthetic
percentage is used. The public callback remains optional and does not change
result or error behavior when absent.

## Streaming feasibility

True streaming diff is not a compatible optimization of the current BSDiff
algorithm: suffix-array construction and matching require global random access
to both inputs. Supporting it would mean selecting a different algorithm or a
new patch format, with an explicit compatibility and migration decision.

Patch application uses a bounded C implementation that reads the old file and
compressed control/diff/extra stream in chunks, writes a temporary destination,
and retains the `ENDSLEY/BSDIFF43` contract. `Blob`/`File` inputs use read-only
WORKERFS mounts in browsers. Direct browser file-handle output remains a
progressive enhancement because the public API still returns a complete buffer.

## Delivery sequence

1. Keep 16/64/128 MiB time and peak-memory baselines for native and Web.
2. Measure the completed C/WASM progress and bounded patch path on comparable
   devices, including peak memory before and after the change.
3. Evaluate direct browser writable-file output without weakening cancellation,
   resource limits, cleanup, or byte-for-byte compatibility.
4. Treat a streaming diff algorithm or new patch format as a separate proposal.

Any production API must preserve deterministic output validation, reject sizes
outside configured limits before large allocations where possible, clean up on
cancellation and failure, and pass Android API 24, iOS Simulator, browser, and
cross-platform golden-patch tests.

## Non-goals

- Claiming that a single measured desktop result is a mobile support guarantee.
- Advertising inputs larger than 128 MiB without a new measurement record.
- Uploading user files to a hosted service; the site toolkit remains local-only.
- Introducing simulated progress merely to make a long operation look active.
