import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runOperation } from '../web/operations.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  await readFile(
    path.join(scriptDirectory, '../fixtures/cross-platform.json'),
    'utf8'
  )
);

const encoder = new TextEncoder();
const oldData = encoder.encode('hello from the old file\n'.repeat(128));
const newData = encoder.encode(
  'hello from the new file\n'.repeat(96) + 'web round trip\n'.repeat(32)
);

const patchData = await runOperation('diff', oldData, newData);
assert.ok(patchData.byteLength > 24, 'diff should produce a non-empty patch');
assert.equal(
  new TextDecoder().decode(patchData.subarray(0, 16)),
  'ENDSLEY/BSDIFF43',
  'Web patches must use the same format as Android and iOS'
);

const restoredData = await runOperation('patch', oldData, patchData);
assert.deepEqual(
  restoredData,
  newData,
  'patch should reconstruct the new bytes'
);

const goldenOldData = new Uint8Array(Buffer.from(fixture.oldBase64, 'base64'));
const goldenNewData = new Uint8Array(Buffer.from(fixture.newBase64, 'base64'));
const goldenPatchData = new Uint8Array(
  Buffer.from(fixture.patchBase64, 'base64')
);

await assert.rejects(
  runOperation('patch', goldenOldData, goldenPatchData, {
    maxOutputBytes: goldenNewData.byteLength - 1,
  }),
  (error) => error && error.code === 'ERESOURCE',
  'declared patch outputs over the configured limit should reject before patching'
);

await assert.rejects(
  runOperation('patch', goldenOldData, goldenPatchData.subarray(0, 25)),
  (error) => error && error.code === 'EWEBASSEMBLY',
  'truncated compressed patch data should fail without exiting the runtime'
);

await assert.rejects(
  runOperation('patch', oldData, new Uint8Array([1, 2, 3])),
  (error) => error && error.code === 'EWEBASSEMBLY',
  'corrupt patches should reject with a WebAssembly error'
);

assert.deepEqual(
  await runOperation('diff', goldenOldData, goldenNewData),
  goldenPatchData,
  'Web diff output should remain byte-compatible with the cross-platform fixture'
);
assert.deepEqual(
  await runOperation('patch', goldenOldData, goldenPatchData),
  goldenNewData,
  'Web should apply the patch shared with Android and iOS'
);

console.log('WebAssembly diff/patch round trip passed');
