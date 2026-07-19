# react-native-bs-diff-patch

Create a compact binary patch from two versions of a file, then reconstruct the
new version from the old file and that patch. Android, iOS, and React Native Web
all use the compatible `ENDSLEY/BSDIFF43` wire format.

[Documentation](https://bs-dff-patch.corerobin.com/docs/) ·
[Playground](https://bs-dff-patch.corerobin.com/#playground) ·
[中文说明](./README.zh-CN.md) · [npm](https://www.npmjs.com/package/react-native-bs-diff-patch)

## Why use it?

- **One patch format:** generate on one supported runtime and apply on another.
- **Both React Native architectures:** legacy bridge and TurboModule/New Architecture.
- **Responsive by default:** native work uses dedicated serial queues; Web work
  reuses a module Worker and cached WebAssembly instance off the page thread.
- **Control expensive work:** native jobs expose progress, cooperative
  cancellation, input/output limits, and atomic output; Web uses
  `AbortSignal` and binary limits.
- **No Web service required:** the browser implementation is the same bundled C
  core compiled to WebAssembly.

| Runtime      | Input model        | Create a patch | Apply a patch |
| ------------ | ------------------ | -------------- | ------------- |
| Android, iOS | Absolute paths     | `diff`         | `patch`       |
| Web          | In-memory binaries | `diffBytes`    | `patchBytes`  |

## Installation

```sh
npm install react-native-bs-diff-patch
```

After adding the package, install iOS pods and rebuild the native app:

```sh
npx pod-install
```

React Native autolinking handles native registration. A Metro reload alone is
not enough after adding a native dependency.

## Native quick start

The native API works with absolute file paths. Use the filesystem library
already present in your app to select a writable cache directory.

```ts
import { diff, patch } from 'react-native-bs-diff-patch';

type NativeRoundTripOptions = {
  oldFilePath: string;
  newFilePath: string;
  cacheDirectory: string;
};

export async function nativeRoundTrip({
  oldFilePath,
  newFilePath,
  cacheDirectory,
}: NativeRoundTripOptions) {
  const runId = Date.now();
  const patchPath = `${cacheDirectory}/update-${runId}.patch`;
  const restoredPath = `${cacheDirectory}/restored-${runId}.bin`;

  await diff(oldFilePath, newFilePath, patchPath);
  await patch(oldFilePath, restoredPath, patchPath);

  return { patchPath, restoredPath };
}
```

Output paths must not exist, all paths in one call must be different, and the
required input files must already exist. Both functions resolve to `0` on
success.

Use the job API when the operation needs progress, cancellation, or resource
bounds:

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
} finally {
  unsubscribe();
}
```

## React Native Web quick start

```ts
import { diffBytes, patchBytes } from 'react-native-bs-diff-patch';

export async function webRoundTrip(
  oldFile: File,
  newFile: File,
  signal?: AbortSignal
) {
  const oldData = await oldFile.arrayBuffer();
  const newData = await newFile.arrayBuffer();
  const options = {
    signal,
    maxInputBytes: 64 * 1024 * 1024,
    maxOutputBytes: 64 * 1024 * 1024,
  };
  const patchData = await diffBytes(oldData, newData, options);
  const restoredData = await patchBytes(oldData, patchData, options);

  return { patchData, restoredData };
}
```

`diffBytes` and `patchBytes` accept `ArrayBuffer`, any `ArrayBufferView`
(including typed arrays and `DataView`), or `Blob`. They resolve to a new
`Uint8Array` and leave the caller's buffers usable. Aborted operations reject
with `EABORTED`; configured size limits reject with `ERESOURCE`.

## Platform API matrix

| API                                        | Android | iOS | Web |
| ------------------------------------------ | ------- | --- | --- |
| `diff(oldPath, newPath, patchPath)`        | Yes     | Yes | No  |
| `patch(oldPath, outputPath, patchPath)`    | Yes     | Yes | No  |
| `startDiff(...)` / `startPatch(...)`       | Yes     | Yes | No  |
| `diffBytes(oldData, newData, options?)`    | No      | No  | Yes |
| `patchBytes(oldData, patchData, options?)` | No      | No  | Yes |
| Legacy architecture (when provided by RN)  | Yes     | Yes | N/A |
| New Architecture / TurboModule             | Yes     | Yes | N/A |

Calling an API family that is unavailable on the current platform rejects with
`EUNSUPPORTED` instead of silently choosing different behavior.

## Production checklist

- Verify the restored output before replacing application data.
- Authenticate patches from remote or otherwise untrusted sources.
- Use unique native output paths and clean temporary files after success or failure.
- Set product-specific input-size and time limits; binary diffing can use
  several times the input size in peak memory.
- Generate and apply patches with this library. Generic `BSDIFF40` patches are
  not interchangeable with `ENDSLEY/BSDIFF43` patches.

See [Production recipes](./docs/recipes.md) for error handling, downloads,
cross-runtime patch exchange, and integrity checks.

CI directly compiles the Android New Architecture sources against React Native
0.73.11, 0.74.7, and 0.86.0. Packed-consumer tests also verify that browser,
ESM, CommonJS, and TypeScript resolution work without installing optional React
Native peers for Web-only consumers.

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
