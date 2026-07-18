import assert from 'node:assert/strict';

import { runOperation } from '../web/operations.mjs';

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

await assert.rejects(
  runOperation('patch', oldData, new Uint8Array([1, 2, 3])),
  (error) => error && error.code === 'EWEBASSEMBLY',
  'corrupt patches should reject with a WebAssembly error'
);

console.log('WebAssembly diff/patch round trip passed');
