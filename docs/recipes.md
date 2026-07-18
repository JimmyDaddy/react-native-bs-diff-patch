# Production recipes

These patterns cover the application responsibilities around the patch engine:
unique paths, cleanup, integrity, and platform boundaries.

## Handle classified errors

Error messages are diagnostic text. Use `code` for recovery decisions.

```ts
type PatchError = Error & { code?: string };

export function isPatchError(error: unknown): error is PatchError {
  return error instanceof Error;
}

try {
  await patch(oldPath, outputPath, patchPath);
} catch (error) {
  if (isPatchError(error) && error.code === 'EEXIST') {
    // Remove a known temporary output or retry with a new unique path.
  } else if (isPatchError(error) && error.code === 'ENOENT') {
    // Re-download or re-resolve the required old file or patch.
  } else {
    throw error;
  }
}
```

Do not remove a user-owned destination merely because `EEXIST` was returned.
Only clean paths your application created as temporary outputs.

## Exchange a patch across runtimes

All platforms use `ENDSLEY/BSDIFF43`, so a valid workflow can cross runtime
boundaries:

1. Generate a patch with `diff` on Android or iOS, or `diffBytes` on Web.
2. Store or transfer the patch as opaque binary data without text conversion.
3. Deliver the exact baseline file expected by that patch.
4. Apply it with the API family for the destination runtime.
5. Verify the restored bytes against a trusted target hash.

The baseline identity matters as much as the patch. A valid patch applied to
the wrong baseline is not a supported update workflow.

## Authenticate remote patches

Transport security alone does not establish that a patch belongs to the
expected release. Distribute a signed manifest containing at least:

- baseline version or baseline digest;
- patch digest and byte length;
- target digest and byte length;
- patch format identifier;
- release identifier and signature metadata.

Verify the manifest and downloaded patch before applying it. Verify the restored
file before replacing application data. Cryptographic signing and hashing stay
outside this library so applications can use their existing trust model.

## Use atomic replacement on native

Write the reconstructed file to a unique path in the same storage area as the
final destination. After integrity verification, use the filesystem layer to
atomically rename or replace the destination when the platform supports it.
Never ask `patch` to overwrite the active file directly; output paths are
required to be unused.

## Bound resource use

The algorithm operates on complete buffers and peak memory can be several times
the input or output size. Before starting an operation:

- reject input larger than the product's tested limit;
- confirm sufficient local storage for native temporary outputs;
- prevent unbounded simultaneous calls from user actions;
- expose cancellation at the surrounding workflow level when appropriate;
- move very large update generation to controlled backend infrastructure.

Native calls share a library-owned serial queue. Separate Web calls each create
their own Worker, so the application should limit Web concurrency explicitly.

## Download a Web patch

Create an object URL, trigger the download, and revoke the URL after use:

```ts
const patchData = await diffBytes(oldFile, newFile);
const url = URL.createObjectURL(new Blob([patchData]));
const link = Object.assign(document.createElement('a'), {
  href: url,
  download: 'release.patch',
});
link.click();
URL.revokeObjectURL(url);
```

Keep the bytes binary when uploading or storing them. Converting arbitrary
patch bytes through UTF-8 strings corrupts the data.
