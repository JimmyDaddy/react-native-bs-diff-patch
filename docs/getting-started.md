# Getting started

This guide installs the package, selects the correct API family, and completes
a patch round trip.

## Install

```sh
npm install react-native-bs-diff-patch
```

Install iOS pods after adding or updating the native dependency:

```sh
npx pod-install
```

React Native autolinking handles Android and iOS registration. Rebuild the
native application after installation; reloading Metro does not change the
native modules inside an already-installed binary.

## Choose the API for the runtime

| Runtime      | Use                          | Do not use       |
| ------------ | ---------------------------- | ---------------- |
| Android, iOS | `diff` and `patch`           | Binary-data APIs |
| Web          | `diffBytes` and `patchBytes` | File-path APIs   |

The unavailable family rejects with `EUNSUPPORTED`, which helps catch imports
that resolved to an unexpected platform entry.

## Native file workflow

Native APIs operate on absolute file paths. The library does not choose a
storage directory or manage file lifetime; use the filesystem solution already
present in your application.

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
  const patchPath = `${cacheDirectory}/release-${runId}.patch`;
  const restoredPath = `${cacheDirectory}/release-${runId}.restored`;

  await diff(oldFilePath, newFilePath, patchPath);
  await patch(oldFilePath, restoredPath, patchPath);

  return { patchPath, restoredPath };
}
```

Before calling `diff`:

- `oldFilePath` and `newFilePath` must exist.
- `patchPath` must not exist.
- All three paths must be non-empty and different.

Before calling `patch`:

- `oldFilePath` and `patchPath` must exist.
- `restoredPath` must not exist.
- All three paths must be non-empty and different.

Use a content hash or byte comparison from your filesystem layer to verify that
`restoredPath` matches `newFilePath`. Clean the patch and restored file when
they are no longer needed.

## Web binary workflow

React Native Web uses binary values instead of filesystem paths:

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

if (!matches) {
  throw new Error('Patch round trip did not reproduce the target data');
}
```

Inputs are copied before being transferred to the module Worker, so the
caller's buffers remain usable. Each result is a new `Uint8Array`.

## Use browser files

```ts
import { diffBytes } from 'react-native-bs-diff-patch';

export async function downloadPatch(oldFile: File, newFile: File) {
  const patchData = await diffBytes(oldFile, newFile);
  const url = URL.createObjectURL(
    new Blob([patchData], { type: 'application/octet-stream' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'update.patch';
  link.click();
  URL.revokeObjectURL(url);
}
```

The Web API is client-only. Importing it during server-side rendering is safe,
but call it only after a browser `Worker` is available.

## Next steps

- Copy a recovery pattern from [Production recipes](./recipes.md).
- Review all signatures and error codes in the [API reference](./api-reference.md).
- Check [platform and bundler support](./platform-support.md).
- Try the [live Playground](https://bs-dff-patch.corerobin.com/#playground).
