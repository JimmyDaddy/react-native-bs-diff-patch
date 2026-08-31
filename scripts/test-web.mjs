import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyRuntimeErrorCode, runOperation } from '../web/operations.mjs';
import { inspectPatch } from '../web/index.mjs';

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

assert.equal(
  classifyRuntimeErrorCode(
    new WebAssembly.RuntimeError('memory access out of bounds'),
    'memory access out of bounds'
  ),
  'ERESOURCE',
  'WebAssembly OOM failures should use the portable resource code'
);

const progressEvents = [];
const patchData = await runOperation('diff', oldData, newData, {
  onProgress: (event) => progressEvents.push(event),
});
assert.ok(
  progressEvents.some(
    (event) => event.phase === 'processing' && event.progress > 0
  ),
  'WebAssembly should expose real processing checkpoints'
);
assert.deepEqual(progressEvents.at(-1), {
  operation: 'diff',
  phase: 'writing',
  progress: 1,
});
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
const metadata = await inspectPatch(patchData);
assert.deepEqual(metadata, {
  declaredTargetBytes: String(newData.byteLength),
  format: 'ENDSLEY/BSDIFF43',
  headerBytes: 24,
  patchBytes: patchData.byteLength,
  payloadBytes: patchData.byteLength - 24,
  valid: true,
});
const patchBlob = new Blob([patchData]);
patchBlob.arrayBuffer = async () => {
  throw new Error('inspectPatch must not read the complete Blob');
};
assert.deepEqual(
  await inspectPatch(patchBlob),
  metadata,
  'Blob inspection should read only the 24-byte patch header'
);
assert.deepEqual(await inspectPatch(new Uint8Array([1, 2, 3])), {
  declaredTargetBytes: null,
  format: 'UNKNOWN',
  headerBytes: 3,
  issue: 'TRUNCATED_HEADER',
  patchBytes: 3,
  payloadBytes: 0,
  valid: false,
});

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
  (error) => error && error.code === 'EPATCH',
  'corrupt patch headers should reject with the portable patch error'
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

class MockWorker {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.messages = [];
    this.terminated = false;
    MockWorker.instances.push(this);
  }

  postMessage(...arguments_) {
    this.messages.push(arguments_);
  }

  terminate() {
    this.terminated = true;
  }

  emitMessage(data) {
    this.onmessage?.({ data });
  }

  emitError(message = 'synthetic worker failure') {
    this.onerror?.({ message });
  }

  emitMessageError() {
    this.onmessageerror?.({});
  }
}

function requestFor(worker, index = 0) {
  return worker.messages[index][0];
}

function resultFor(worker, output, index = 0) {
  worker.emitMessage({
    id: requestFor(worker, index).id,
    type: 'result',
    ok: true,
    output,
  });
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
Object.defineProperty(globalThis, 'Worker', {
  configurable: true,
  value: MockWorker,
  writable: true,
});

try {
  const webApi = await import(
    new URL(
      `../web/index.mjs?worker-lifecycle=${Date.now()}`,
      import.meta.url
    ).href
  );
  const workerOld = new Uint8Array([1, 2, 3]);
  const workerInput = new Uint8Array([4, 5, 6]);
  const workerOldSnapshot = workerOld.slice();
  const workerInputSnapshot = workerInput.slice();

  const firstRequest = webApi.diffBytes(workerOld, workerInput);
  const firstWorker = MockWorker.instances.at(-1);
  assert.equal(firstWorker.messages.length, 1);
  assert.equal(
    firstWorker.messages[0].length,
    1,
    'Web byte inputs must not be transferred to the Worker'
  );
  assert.deepEqual(workerOld, workerOldSnapshot);
  assert.deepEqual(workerInput, workerInputSnapshot);
  resultFor(firstWorker, new Uint8Array([7, 8, 9]));
  assert.deepEqual(await firstRequest, new Uint8Array([7, 8, 9]));
  assert.deepEqual(workerOld, workerOldSnapshot);
  assert.deepEqual(workerInput, workerInputSnapshot);

  const sharedFailureOne = webApi.diffBytes(workerOld, workerInput);
  const sharedFailureTwo = webApi.patchBytes(workerOld, workerInput);
  assert.equal(
    MockWorker.instances.length,
    1,
    'Requests without a signal should share one Worker'
  );
  firstWorker.emitError();
  await assert.rejects(
    sharedFailureOne,
    (error) => error && error.code === 'EWEBASSEMBLY'
  );
  await assert.rejects(
    sharedFailureTwo,
    (error) => error && error.code === 'EWEBASSEMBLY'
  );
  assert.equal(firstWorker.terminated, true);

  const recoveryRequest = webApi.diffBytes(workerOld, workerInput);
  const recoveryWorker = MockWorker.instances.at(-1);
  assert.notEqual(recoveryWorker, firstWorker);
  firstWorker.emitMessage({
    id: requestFor(firstWorker, 1).id,
    type: 'result',
    ok: true,
    output: new Uint8Array([99]),
  });
  firstWorker.emitError('late worker failure');
  assert.equal(
    recoveryWorker.terminated,
    false,
    'Late events from an old shared Worker must not reset its replacement'
  );
  resultFor(recoveryWorker, new Uint8Array([10]));
  assert.deepEqual(await recoveryRequest, new Uint8Array([10]));

  const messageErrorRequest = webApi.diffBytes(workerOld, workerInput);
  recoveryWorker.emitMessageError();
  await assert.rejects(
    messageErrorRequest,
    (error) => error && error.code === 'EWEBASSEMBLY'
  );
  assert.equal(recoveryWorker.terminated, true);

  const workerCountBeforeInvalidSignal = MockWorker.instances.length;
  await assert.rejects(
    webApi.diffBytes(workerOld, workerInput, { signal: {} }),
    (error) => error && error.code === 'EINVAL'
  );
  assert.equal(
    MockWorker.instances.length,
    workerCountBeforeInvalidSignal,
    'Malformed signals must reject before creating a Worker'
  );

  let cancellationProgressEvents = 0;
  const cancelledJob = webApi.startDiffBytes(workerOld, workerInput);
  const cancelledWorker = MockWorker.instances.at(-1);
  cancelledJob.onProgress(() => {
    cancellationProgressEvents += 1;
  });
  cancelledWorker.emitMessage({
    type: 'progress',
    progress: { operation: 'diff', phase: 'processing', progress: 0.5 },
  });
  const cancellation = cancelledJob.cancel();
  assert.equal(cancelledWorker.terminated, true);
  cancelledWorker.emitMessage({
    type: 'progress',
    progress: { operation: 'diff', phase: 'writing', progress: 1 },
  });
  resultFor(cancelledWorker, new Uint8Array([11]));
  await cancellation;
  await assert.rejects(
    cancelledJob.result,
    (error) => error && error.code === 'EABORTED'
  );
  assert.equal(
    cancellationProgressEvents,
    1,
    'Cancelled jobs must ignore late Worker progress and results'
  );

  const completedJob = webApi.startPatchBytes(workerOld, workerInput);
  const completedWorker = MockWorker.instances.at(-1);
  resultFor(completedWorker, new Uint8Array([12]));
  assert.deepEqual(await completedJob.result, new Uint8Array([12]));
  await completedJob.cancel();
  assert.deepEqual(
    await completedJob.result,
    new Uint8Array([12]),
    'Cancelling an already-completed job must preserve its result'
  );

  const patchHeader = new Uint8Array(24);
  patchHeader.set(new TextEncoder().encode('ENDSLEY/BSDIFF43'));
  patchHeader[16] = 1;
  let releaseExpectedData;
  const delayedExpected = new Blob([new Uint8Array([13])]);
  Object.defineProperty(delayedExpected, 'arrayBuffer', {
    value: () =>
      new Promise((resolve) => {
        releaseExpectedData = () => resolve(new Uint8Array([13]).buffer);
      }),
  });
  const verificationAbort = new AbortController();
  const verification = webApi.verifyPatch(
    workerOld,
    patchHeader,
    delayedExpected,
    { signal: verificationAbort.signal }
  );
  const verificationWorker = await waitFor(
    () => MockWorker.instances.at(-1) !== completedWorker && MockWorker.instances.at(-1),
    'verifyPatch did not start a dedicated Worker'
  );
  await waitFor(
    () => releaseExpectedData,
    'verifyPatch did not begin reading the expected payload'
  );
  resultFor(verificationWorker, new Uint8Array([13]));
  verificationAbort.abort();
  releaseExpectedData();
  await assert.rejects(
    verification,
    (error) => error && error.code === 'EABORTED',
    'verifyPatch must observe cancellation after concurrent input reads finish'
  );
} finally {
  if (workerDescriptor) {
    Object.defineProperty(globalThis, 'Worker', workerDescriptor);
  } else {
    delete globalThis.Worker;
  }
}

console.log('WebAssembly diff/patch round trip passed');
