# react-native-bs-diff-patch

Create and apply compact binary patches on Android, iOS, and React Native Web.
The native platforms use the bundled C implementation through JNI/Objective-C++;
Web uses the same implementation compiled to WebAssembly and isolated in a
Web Worker.

[Documentation](https://bs-dff-patch.corerobin.com/docs/) ·
[Playground](https://bs-dff-patch.corerobin.com/#playground) ·
[中文说明](./README.zh-CN.md)

## Features

- One `ENDSLEY/BSDIFF43` patch format across Android, iOS, and Web.
- React Native legacy architecture and TurboModule/New Architecture support.
- Dedicated native worker queues and an isolated Web Worker for expensive work.
- File-path APIs on native and typed binary APIs in the browser.
- TypeScript declarations and deterministic WebAssembly/browser tests.

## Installation

```sh
npm install react-native-bs-diff-patch
```

For iOS, install pods after adding the package:

```sh
npx pod-install
```

## Native quick start

```ts
import { diff, patch } from 'react-native-bs-diff-patch';

const patchPath = `${cacheDirectory}/update.patch`;
const restoredPath = `${cacheDirectory}/restored.bin`;

await diff(oldFilePath, newFilePath, patchPath);
await patch(oldFilePath, restoredPath, patchPath);
```

`diff` expects the old and new files to exist and the patch path to be unused.
`patch` expects the old file and patch to exist and the output path to be unused.
Both resolve to `0` on success.

## React Native Web quick start

```ts
import { diffBytes, patchBytes } from 'react-native-bs-diff-patch';

const oldData = await oldFile.arrayBuffer();
const newData = await newFile.arrayBuffer();

const patchData = await diffBytes(oldData, newData);
const restoredData = await patchBytes(oldData, patchData);
```

`diffBytes` and `patchBytes` accept `ArrayBuffer`, any `ArrayBufferView`
(including typed arrays and `DataView`), or `Blob`, and resolve to a
`Uint8Array`.

## Platform API matrix

| API                                     | Android | iOS | Web |
| --------------------------------------- | ------- | --- | --- |
| `diff(oldPath, newPath, patchPath)`     | Yes     | Yes | No  |
| `patch(oldPath, outputPath, patchPath)` | Yes     | Yes | No  |
| `diffBytes(oldData, newData)`           | No      | No  | Yes |
| `patchBytes(oldData, patchData)`        | No      | No  | Yes |
| Legacy architecture                     | Yes     | Yes | N/A |
| New Architecture / TurboModule          | Yes     | Yes | N/A |

The unsupported API family rejects with `EUNSUPPORTED`, making accidental
cross-platform use explicit.

## Documentation

- [Getting started](./docs/getting-started.md)
- [API reference](./docs/api-reference.md)
- [Platform support](./docs/platform-support.md)
- [Architecture and patch format](./docs/architecture.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Development and verification](./docs/development.md)

## Security and resource limits

Binary diffing is CPU- and memory-intensive. Native work runs off the React
Native module queue and Web work runs in a Worker, but applications should still
apply file-size, time, and trust-boundary limits appropriate to their product.
Validate patch provenance before applying patches received from an untrusted
source.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the local workflow and quality
gates.

## License

MIT
