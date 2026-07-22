# react-native-bs-diff-patch

<p align="center">
  <a href="https://bs-dff-patch.corerobin.com/">
    <img src="https://bs-dff-patch.corerobin.com/assets/social-preview.png" alt="Binary patches everywhere React Native runs: Android, iOS, and Web" width="100%" />
  </a>
</p>

<p align="center">
  <strong>Turn two versions of a file into a compact binary patch, then reconstruct the new file from the old file plus that patch.</strong><br />
  One compatible format across React Native Android, iOS, and Web.
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

## Platform overview

|                | Android / iOS                                | React Native Web                                   |
| -------------- | -------------------------------------------- | -------------------------------------------------- |
| Input          | Absolute file paths                          | `ArrayBuffer`, typed arrays, `DataView`, or `Blob` |
| Basic API      | `diff()` / `patch()`                         | `diffBytes()` / `patchBytes()`                     |
| Controlled API | `startDiff()` / `startPatch()`               | `AbortSignal` and binary limits                    |
| Verification   | Paths via `inspectPatch()` / `verifyPatch()` | Binary values via the same APIs                    |
| Engine         | Native C via JNI / ObjC++                    | Same C core via WASM Worker                        |

## Install

```sh
npm install react-native-bs-diff-patch
```

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

```ts
import { diffBytes, patchBytes } from 'react-native-bs-diff-patch';

const oldBytes = await oldFile.arrayBuffer();
const newBytes = await newFile.arrayBuffer();

const patchBytesValue = await diffBytes(oldBytes, newBytes, {
  signal: abortController.signal,
  maxInputBytes: 64 * 1024 * 1024,
});
const restoredBytes = await patchBytes(oldBytes, patchBytesValue, {
  maxOutputBytes: 64 * 1024 * 1024,
});
```

Web calls return a new `Uint8Array` and leave caller-owned buffers usable.
Aborted operations reject with `EABORTED`; configured binary limits reject with
`ERESOURCE`.

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

| API                                           | Android | iOS | Web |
| --------------------------------------------- | ------- | --- | --- |
| `diff(oldPath, newPath, patchPath)`           | Yes     | Yes | No  |
| `patch(oldPath, outputPath, patchPath)`       | Yes     | Yes | No  |
| `startDiff(...)` / `startPatch(...)`          | Yes     | Yes | No  |
| `diffBytes(oldData, newData, options?)`       | No      | No  | Yes |
| `patchBytes(oldData, patchData, options?)`    | No      | No  | Yes |
| `inspectPatch(path or binary, options?)`      | Yes     | Yes | Yes |
| `verifyPatch(old, patch, expected, options?)` | Yes     | Yes | Yes |
| Legacy architecture, while supplied by RN     | Yes     | Yes | N/A |
| New Architecture / TurboModule                | Yes     | Yes | N/A |

Unavailable platform APIs reject with `EUNSUPPORTED`; the package never
silently switches to a different input model.

## Production safety

- Authenticate patches from remote or otherwise untrusted sources.
- Verify restored output before replacing application data.
- Use unique native output paths and remove outputs you no longer need.
- Set product-specific resource limits. Binary diffing can use several times
  the input size in peak memory.
- Generate and apply patches with this library. Generic `BSDIFF40` patches are
  not interchangeable with `ENDSLEY/BSDIFF43` patches.

See [Production recipes](./docs/recipes.md) for integrity checks, downloads,
cross-runtime exchange, error handling, and cleanup patterns.

## Verified compatibility

CI compiles the Android and iOS APIs against React Native 0.73.11, 0.74.7, and
0.86.0, and runs device-level New Architecture assertions on Android and iOS.
Packed-consumer tests verify browser, ESM, CommonJS, Metro, and TypeScript
resolution from the real npm package shape.

## Documentation

- [Getting started](./docs/getting-started.md)
- [API reference](./docs/api-reference.md)
- [Production recipes](./docs/recipes.md)
- [Platform support](./docs/platform-support.md)
- [Architecture and patch format](./docs/architecture.md)
- [Controllable native operations](./docs/native-operations-v03.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Development and verification](./docs/development.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the local workflow and quality
gates. Release history is in [CHANGELOG.md](./CHANGELOG.md); security reports
follow [SECURITY.md](./SECURITY.md).

## License

MIT
