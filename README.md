# react-native-bs-diff-patch

<p align="center">
  <a href="https://bs-dff-patch.corerobin.com/">
    <img src="https://bs-dff-patch.corerobin.com/assets/social-preview.png" alt="Binary patches everywhere React Native runs: Android, iOS, and Web" width="100%" />
  </a>
</p>

<p align="center">
  <strong>A verified binary delta pipeline for React Native, Web, Node.js, and release CI.</strong><br />
  Create compact patches, prove restored bytes, and plan multi-baseline delivery with one compatible format.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/react-native-bs-diff-patch"><img src="https://img.shields.io/npm/v/react-native-bs-diff-patch?color=b8ff3d&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/react-native-bs-diff-patch"><img src="https://img.shields.io/npm/dm/react-native-bs-diff-patch?color=39e6ff" alt="npm downloads" /></a>
  <a href="https://github.com/JimmyDaddy/react-native-bs-diff-patch/actions/workflows/ci.yml"><img src="https://github.com/JimmyDaddy/react-native-bs-diff-patch/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/react-native-bs-diff-patch?color=f6bf6f" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="https://bs-dff-patch.corerobin.com/docs/">Documentation</a> ·
  <a href="https://bs-dff-patch.corerobin.com/#playground">Live Playground</a> ·
  <a href="https://bs-dff-patch.corerobin.com/tools/">Binary Patch Toolkit</a> ·
  <a href="https://bs-dff-patch.corerobin.com/planner/">Release Planner</a> ·
  <a href="./README.zh-CN.md">中文说明</a> ·
  <a href="https://www.npmjs.com/package/react-native-bs-diff-patch">npm</a>
</p>

## What does it do?

Use it when your app already has an old version of a file and you want to move
to a new version without transporting the complete replacement file.

| 1. Create the delta                                          | 2. Deliver it your way                                                    | 3. Reconstruct the file                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Compare `old.bin` with `new.bin` and produce `update.patch`. | Send or store the patch with your existing CDN, API, or offline workflow. | Apply `update.patch` to `old.bin` and write the restored `new.bin`. |

The library handles binary diffing and patching. Your application remains in
control of transport, authentication, integrity checks, and when an output
replaces live data.

## Why this package?

- **One wire format:** Android, iOS, and Web produce compatible
  `ENDSLEY/BSDIFF43` patches.
- **Every current RN runtime:** legacy bridge and TurboModule/New Architecture
  are both supported.
- **Native performance, browser reach:** JNI/ObjC++ use the bundled C core;
  React Native Web runs that core as WebAssembly in a reusable module Worker.
- **Control expensive native work:** observe progress, cancel cooperatively,
  cap input/output sizes, and avoid exposing partial output files.
- **No patch service required:** Web diffing and patching happen locally in the
  browser.
- **Inspect and prove compatibility:** read patch metadata and verify restored
  bytes through the same API shape on native and Web.
- **Release-side tooling:** generate patches through `npx`, publish verified
  manifests, and choose a patch or full-file fallback for each baseline.

## Platform overview

|                | Android / iOS                                | React Native Web                                   |
| -------------- | -------------------------------------------- | -------------------------------------------------- |
| Input          | Absolute file paths                          | `ArrayBuffer`, typed arrays, `DataView`, or `Blob` |
| Basic API      | `diff()` / `patch()`                         | `diffBytes()` / `patchBytes()`                     |
| Controlled API | `startDiff()` / `startPatch()`               | Binary `startDiff()` / `startPatch()` jobs         |
| Verification   | Paths via `inspectPatch()` / `verifyPatch()` | Binary values via the same APIs                    |
| Engine         | Native C via JNI / ObjC++                    | Same C core via WASM Worker                        |

## Release-side CLI and bundles

The same npm package includes a Node.js CLI for release pipelines:

```sh
npx react-native-bs-diff-patch diff old.bin new.bin -o update.patch
npx react-native-bs-diff-patch verify old.bin update.patch new.bin
npx react-native-bs-diff-patch bundle \
  --from releases/ \
  --to dist/app.bin \
  --out dist/update-bundle
```

`bundle` evaluates every baseline, retains efficient patches, adds a full-file
fallback, and writes a canonical verified manifest suitable for CDN selection
and detached signing. The CLI mounts host paths through NODEFS, while verified
patch application uses the bounded streaming core. Try the workflow in the browser with the
[Release Planner](https://bs-dff-patch.corerobin.com/planner/).

## Install

```sh
npm install react-native-bs-diff-patch@^0.5.0
```

The explicit `/web` and `/toolkit` entries are part of 0.5.0. For pre-release
verification of a locally prepared package, the same entries can be tested from
its tarball instead:

```sh
npm install ./react-native-bs-diff-patch-0.5.0.tgz
```

The registry's 0.4.x package predates these subpaths. See the [Web and desktop
WebView SDK guide](./docs/web-sdk.md) for the resource graph and consumer checks.

For iOS, install Pods and rebuild the native application:

```sh
npx pod-install
```

React Native autolinking handles native registration. Adding a native module
requires a native rebuild; a Metro reload is not enough.

## Native: first round trip

Native APIs use absolute paths. Pick unique output paths in a writable cache or
documents directory through the filesystem library already used by your app.

```ts
import { diff, patch } from 'react-native-bs-diff-patch';

const patchPath = `${cacheDirectory}/content-v2.patch`;
const restoredPath = `${cacheDirectory}/content-v2.restored`;

await diff(oldFilePath, newFilePath, patchPath);
await patch(oldFilePath, restoredPath, patchPath);
```

Input files must already exist. Output paths must not exist, and all paths in a
single call must be different. Both functions resolve to `0` on success.

### Progress, cancellation, and limits

Use the job API for work that needs lifecycle control:

```ts
import { startPatch } from 'react-native-bs-diff-patch';

const job = startPatch(oldPath, outputPath, patchPath, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
});

const unsubscribe = job.onProgress(({ phase, progress }) => {
  renderProgress(phase, progress);
});

try {
  await job.result;
  // await job.cancel(); // cancel from your UI when needed
} finally {
  unsubscribe();
}
```

## Web: first round trip

Standalone browser, Vite, and Tauri consumers should import the explicit ESM
entry `react-native-bs-diff-patch/web`; it exposes byte APIs and does not
require React Native. The root package keeps its conditional React Native and
browser resolution for existing applications. See the [Web and desktop WebView
SDK guide](./docs/web-sdk.md) for the published resource graph and CSP.

```ts
import { diffBytes, patchBytes } from 'react-native-bs-diff-patch/web';

const patchBytesValue = await diffBytes(oldFile, newFile, {
  signal: abortController.signal,
  maxInputBytes: 64 * 1024 * 1024,
  onProgress: ({ phase, progress }) => {
    renderProgress(phase, progress);
  },
});
const restoredBytes = await patchBytes(oldFile, patchBytesValue, {
  maxOutputBytes: 64 * 1024 * 1024,
});
```

Web calls return a new `Uint8Array` and leave caller-owned buffers usable.
Aborted operations reject with `EABORTED`; configured binary limits reject with
`ERESOURCE`. `Blob` and `File` inputs are mounted read-only in the Worker, so
they do not need a full main-thread copy before the C core reads them.

Use `startDiff()` / `startPatch()` with binary inputs on Web, or the explicit
`startDiffBytes()` / `startPatchBytes()` aliases, when UI code needs a job
object with `result`, `cancel()`, and real C-core progress events.

## Inspect and verify a patch

Use `inspectPatch()` for a cheap structural check, then `verifyPatch()` to apply
into a temporary result and compare it with the expected target byte-for-byte:

```ts
import { inspectPatch, verifyPatch } from 'react-native-bs-diff-patch';

// Android / iOS use paths. Web uses File, Blob, ArrayBuffer, or typed arrays.
const metadata = await inspectPatch(patchPath);
const result = await verifyPatch(oldPath, patchPath, expectedPath, {
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
});

if (!metadata.valid || !result.verified) {
  throw new Error('Patch compatibility check failed');
}
```

The native verification output is temporary and always cleaned up. The Web
form accepts `oldFile`, `patchFile`, and `expectedFile` in the same argument
order. Structural validity is diagnostic; authenticate trusted hashes in your
update manifest before replacing live data.

## API matrix

| API                                            | Android | iOS   | Web    |
| ---------------------------------------------- | ------- | ----- | ------ |
| `diff(oldPath, newPath, patchPath)`            | Yes     | Yes   | No     |
| `patch(oldPath, outputPath, patchPath)`        | Yes     | Yes   | No     |
| `startDiff(...)` / `startPatch(...)`           | Paths   | Paths | Binary |
| `startDiffBytes(...)` / `startPatchBytes(...)` | No      | No    | Yes    |
| `diffBytes(oldData, newData, options?)`        | No      | No    | Yes    |
| `patchBytes(oldData, patchData, options?)`     | No      | No    | Yes    |
| `inspectPatch(path or binary, options?)`       | Yes     | Yes   | Yes    |
| `verifyPatch(old, patch, expected, options?)`  | Yes     | Yes   | Yes    |
| Legacy architecture, while supplied by RN      | Yes     | Yes   | N/A    |
| New Architecture / TurboModule                 | Yes     | Yes   | N/A    |

Unavailable platform APIs reject with `EUNSUPPORTED`; the package never
silently switches to a different input model.

## Production safety

- Authenticate patches from remote or otherwise untrusted sources.
- Verify restored output before replacing application data.
- Use unique native output paths and remove outputs you no longer need.
- Set product-specific resource limits. Binary diffing can use several times
  the input size in peak memory.
- Runtime APIs accept `ENDSLEY/BSDIFF43`. Convert existing `BSDIFF40` files
  offline with `npx react-native-bs-diff-patch convert legacy.patch -o
compatible.patch`, then verify them before publishing.

See [Production recipes](./docs/recipes.md) for integrity checks, downloads,
cross-runtime exchange, error handling, and cleanup patterns.

## Verified compatibility

CI covers Android and iOS API builds against React Native 0.73.11, 0.74.7, and
0.86.0, and runs the configured New Architecture assertions. These checks do
not constitute Tauri WebView acceptance or downstream physical-device
acceptance. Packed-consumer tests verify browser, ESM, CommonJS, Metro, and
TypeScript resolution from the real npm package shape.

## Documentation

- [Web and desktop WebView SDK](./docs/web-sdk.md) — use the explicit ESM
  `/web` and `/toolkit` entries from Vite or Tauri without React Native or a
  Node sidecar.
- [Getting started](./docs/getting-started.md)
- [API reference](./docs/api-reference.md)
- [Production recipes](./docs/recipes.md)
- [Verified Delta Pipeline](./docs/verified-delta-pipeline.md)
- [Platform support](./docs/platform-support.md)
- [Architecture and patch format](./docs/architecture.md)
- [Controllable native operations](./docs/native-operations-v03.md)
- [Large-file roadmap](./docs/large-files-roadmap.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Development and verification](./docs/development.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the local workflow and quality
gates. Release history is in [CHANGELOG.md](./CHANGELOG.md); security reports
follow [SECURITY.md](./SECURITY.md).

## License

MIT
