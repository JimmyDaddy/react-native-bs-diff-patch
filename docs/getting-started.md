# Getting started

This guide creates a patch, applies it, and verifies the restored output.

## Install

```sh
npm install react-native-bs-diff-patch
```

Install iOS pods after changing native dependencies:

```sh
npx pod-install
```

No manual Android package registration is required when React Native
autolinking is enabled.

## Native file workflow

Native APIs operate on absolute file paths. A filesystem library or your own
native code is responsible for creating and reading those files.

```ts
import { diff, patch } from 'react-native-bs-diff-patch';

const patchPath = `${cacheDirectory}/release-2.patch`;
const restoredPath = `${cacheDirectory}/release-2.restored`;

const diffResult = await diff(oldPath, newPath, patchPath);
const patchResult = await patch(oldPath, restoredPath, patchPath);

if (diffResult !== 0 || patchResult !== 0) {
  throw new Error('Binary patch operation failed');
}
```

Before calling `diff`:

- `oldPath` and `newPath` must exist.
- `patchPath` must not exist.
- All three paths must be different.

Before calling `patch`:

- `oldPath` and `patchPath` must exist.
- `restoredPath` must not exist.
- All three paths must be different.

Remove stale outputs or choose unique names before retrying an operation.

## Web binary workflow

React Native Web uses binary data instead of filesystem paths:

```ts
import { diffBytes, patchBytes } from 'react-native-bs-diff-patch';

const encoder = new TextEncoder();
const oldData = encoder.encode('version 1');
const newData = encoder.encode('version 2 with web support');

const patchData = await diffBytes(oldData, newData);
const restoredData = await patchBytes(oldData, patchData);

const matches =
  restoredData.length === newData.length &&
  restoredData.every((byte, index) => byte === newData[index]);
```

Inputs are copied before being transferred to the worker, so the caller's
buffers remain usable. The result is a new `Uint8Array`.

## Use files in a browser

```ts
const oldData = await oldFile.arrayBuffer();
const newData = await newFile.arrayBuffer();
const patchData = await diffBytes(oldData, newData);

const download = document.createElement('a');
download.href = URL.createObjectURL(
  new Blob([patchData], { type: 'application/octet-stream' })
);
download.download = 'update.patch';
download.click();
```

## Next steps

- Read the [API reference](./api-reference.md).
- Check [platform and bundler support](./platform-support.md).
- Understand the [execution architecture](./architecture.md).
- Try the [live Playground](https://bs-dff-patch.corerobin.com/#playground).
