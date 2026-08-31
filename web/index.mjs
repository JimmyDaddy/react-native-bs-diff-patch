function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const ERROR_CATEGORIES = new Map([
  ['EABORTED', 'ABORTED'],
  ['ECANCELLED', 'ABORTED'],
  ['ERESOURCE', 'RESOURCE'],
  ['EINPUT_TOO_LARGE', 'RESOURCE'],
  ['EOUTPUT_TOO_LARGE', 'RESOURCE'],
  ['EINVAL', 'INVALID_ARGUMENT'],
  ['EINVALID_MANIFEST', 'INVALID_PATCH'],
  ['EPATCH', 'INVALID_PATCH'],
  ['ELEGACYFORMAT', 'INVALID_PATCH'],
  ['EBASELINEMISMATCH', 'VERIFICATION'],
  ['EPATCHMISMATCH', 'VERIFICATION'],
  ['ETARGETMISMATCH', 'VERIFICATION'],
  ['EDESTEXISTS', 'DESTINATION'],
  ['EUNSUPPORTED', 'UNSUPPORTED'],
]);

export function classifyPatchError(error) {
  const code =
    error && typeof error === 'object' && typeof error.code === 'string'
      ? error.code
      : 'EUNSPECIFIED';
  return {
    category: ERROR_CATEGORIES.get(code) || 'RUNTIME',
    code,
    message:
      error instanceof Error
        ? error.message
        : String(error || 'unknown patch error'),
    retryable: code === 'EABORTED' || code === 'ECANCELLED',
  };
}

const PATCH_MAGIC = 'ENDSLEY/BSDIFF43';
const PATCH_HEADER_BYTES = 24;

function validateLimit(value, fieldName) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw createError(
      'EINVAL',
      `${fieldName} must be a non-negative safe integer`
    );
  }
}

function validateOperationOptions(options) {
  if (options === null || typeof options !== 'object') {
    throw createError('EINVAL', 'operation options must be an object');
  }
  validateLimit(options.maxInputBytes, 'maxInputBytes');
  validateLimit(options.maxOutputBytes, 'maxOutputBytes');
  if (
    options.signal !== undefined &&
    (!options.signal ||
      typeof options.signal.addEventListener !== 'function' ||
      typeof options.signal.removeEventListener !== 'function' ||
      typeof options.signal.aborted !== 'boolean')
  ) {
    throw createError('EINVAL', 'signal must be an AbortSignal');
  }
  if (
    options.onProgress !== undefined &&
    typeof options.onProgress !== 'function'
  ) {
    throw createError('EINVAL', 'onProgress must be a function');
  }
}

function inputByteLength(input) {
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    return input.byteLength;
  }
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return input.size;
  }
  return undefined;
}

function enforceLimit(actualBytes, maximumBytes, fieldName) {
  if (maximumBytes !== undefined && actualBytes > maximumBytes) {
    throw createError(
      'ERESOURCE',
      `${fieldName} is ${actualBytes} bytes and exceeds the ${maximumBytes} byte limit`
    );
  }
}

function decodePatchMetadata(patchData, patchBytes = patchData.byteLength) {
  const headerBytes = Math.min(patchData.byteLength, PATCH_HEADER_BYTES);
  const legacyMagic = String.fromCharCode(
    ...patchData.slice(0, Math.min(8, patchData.byteLength))
  );
  const currentMagic = String.fromCharCode(
    ...patchData.slice(0, Math.min(16, patchData.byteLength))
  );
  const common = {
    patchBytes,
    headerBytes,
    payloadBytes: Math.max(0, patchBytes - PATCH_HEADER_BYTES),
  };

  if (patchData.byteLength < PATCH_HEADER_BYTES) {
    return {
      metadata: {
        ...common,
        declaredTargetBytes: null,
        format: legacyMagic === 'BSDIFF40' ? 'BSDIFF40' : 'UNKNOWN',
        issue:
          legacyMagic === 'BSDIFF40' ? 'LEGACY_FORMAT' : 'TRUNCATED_HEADER',
        valid: false,
      },
      targetBytes: undefined,
    };
  }
  if (currentMagic !== PATCH_MAGIC) {
    return {
      metadata: {
        ...common,
        declaredTargetBytes: null,
        format: legacyMagic === 'BSDIFF40' ? 'BSDIFF40' : 'UNKNOWN',
        issue: legacyMagic === 'BSDIFF40' ? 'LEGACY_FORMAT' : 'INVALID_MAGIC',
        valid: false,
      },
      targetBytes: undefined,
    };
  }
  if ((patchData[23] & 0x80) !== 0) {
    return {
      metadata: {
        ...common,
        declaredTargetBytes: null,
        format: PATCH_MAGIC,
        issue: 'INVALID_TARGET_SIZE',
        valid: false,
      },
      targetBytes: undefined,
    };
  }

  let targetBytes = 0n;
  for (let index = 23; index >= 16; index -= 1) {
    targetBytes = targetBytes * 256n + BigInt(patchData[index]);
  }
  return {
    metadata: {
      ...common,
      declaredTargetBytes: targetBytes.toString(),
      format: PATCH_MAGIC,
      valid: true,
    },
    targetBytes,
  };
}

async function toUint8Array(input, fieldName) {
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input.slice(0));
  }

  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(
      input.buffer,
      input.byteOffset,
      input.byteLength
    ).slice();
  }

  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }

  throw createError(
    'EINVAL',
    `${fieldName} must be an ArrayBuffer, ArrayBufferView, or Blob`
  );
}

async function readPatchHeader(input) {
  const patchBytes = inputByteLength(input);

  if (input instanceof ArrayBuffer) {
    return {
      bytes: new Uint8Array(
        input,
        0,
        Math.min(input.byteLength, PATCH_HEADER_BYTES)
      ),
      patchBytes: input.byteLength,
    };
  }

  if (ArrayBuffer.isView(input)) {
    return {
      bytes: new Uint8Array(
        input.buffer,
        input.byteOffset,
        Math.min(input.byteLength, PATCH_HEADER_BYTES)
      ),
      patchBytes: input.byteLength,
    };
  }

  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return {
      bytes: new Uint8Array(
        await input.slice(0, PATCH_HEADER_BYTES).arrayBuffer()
      ),
      patchBytes: input.size,
    };
  }

  throw createError(
    'EINVAL',
    'patchData must be an ArrayBuffer, ArrayBufferView, or Blob'
  );
}

let sharedWorker;
let sharedRequestId = 0;
const sharedRequests = new Map();

function responseError(operation, workerError) {
  return createError(
    workerError && workerError.code ? workerError.code : 'EWEBASSEMBLY',
    workerError && workerError.message
      ? workerError.message
      : `${operation} worker failed`
  );
}

function resetSharedWorker(error) {
  sharedWorker?.terminate();
  sharedWorker = undefined;
  for (const request of sharedRequests.values()) {
    request.reject(error);
  }
  sharedRequests.clear();
}

function getSharedWorker() {
  if (sharedWorker) {
    return sharedWorker;
  }

  const worker = new Worker(new URL('./worker.browser.mjs', import.meta.url), {
    type: 'module',
  });
  const resetForWorker = (error) => {
    if (sharedWorker === worker) {
      resetSharedWorker(error);
    }
  };
  sharedWorker = worker;
  worker.onmessage = (event) => {
    if (sharedWorker !== worker) {
      return;
    }
    const data = event.data;
    const request = sharedRequests.get(data && data.id);
    if (!request) {
      return;
    }
    if (data.type === 'progress') {
      request.onProgress?.(data.progress);
      return;
    }
    if (data.type !== 'result') {
      resetForWorker(
        createError('EWEBASSEMBLY', 'Shared Web Worker response was invalid')
      );
      return;
    }
    sharedRequests.delete(data.id);

    if (data.ok) {
      try {
        if (!(data.output instanceof Uint8Array)) {
          throw createError(
            'EWEBASSEMBLY',
            'Shared Web Worker returned an invalid output payload'
          );
        }
        enforceLimit(
          data.output.byteLength,
          request.maxOutputBytes,
          'output'
        );
        request.resolve(data.output);
      } catch (error) {
        request.reject(error);
        resetForWorker(error);
      }
      return;
    }
    request.reject(responseError(request.operation, data.error));
  };
  worker.onerror = (event) => {
    resetForWorker(
      createError(
        'EWEBASSEMBLY',
        event.message || 'Shared Web Worker failed to load'
      )
    );
  };
  worker.onmessageerror = () => {
    resetForWorker(
      createError('EWEBASSEMBLY', 'Shared Web Worker response was invalid')
    );
  };
  return worker;
}

function runSharedWorker(operation, oldFileData, inputFileData, options) {
  const worker = getSharedWorker();
  const id = ++sharedRequestId;

  return new Promise((resolve, reject) => {
    sharedRequests.set(id, {
      maxOutputBytes: options.maxOutputBytes,
      operation,
      onProgress: options.onProgress,
      reject,
      resolve,
    });
    try {
      worker.postMessage({
        id,
        operation,
        oldFileData,
        inputFileData,
        maxInputBytes: options.maxInputBytes,
        maxOutputBytes: options.maxOutputBytes,
      });
    } catch (error) {
      sharedRequests.delete(id);
      reject(error);
    }
  });
}

function runDedicatedWorker(operation, oldFileData, inputFileData, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.browser.mjs', import.meta.url), {
      type: 'module',
    });
    let settled = false;

    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      worker.terminate();
      callback();
    };
    const abort = () => {
      finish(() => reject(createError('EABORTED', `${operation} was aborted`)));
    };

    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }

    worker.onmessage = (event) => {
      if (settled) {
        return;
      }
      const data = event.data;
      if (data && data.type === 'progress') {
        options.onProgress?.(data.progress);
        return;
      }
      if (data && data.type === 'result' && data.ok) {
        const output = data.output;
        try {
          if (!(output instanceof Uint8Array)) {
            throw createError(
              'EWEBASSEMBLY',
              `${operation} worker returned an invalid output payload`
            );
          }
          enforceLimit(output.byteLength, options.maxOutputBytes, 'output');
          finish(() => resolve(output));
        } catch (error) {
          finish(() => reject(error));
        }
        return;
      }

      if (data && data.type === 'result') {
        finish(() => reject(responseError(operation, data.error)));
        return;
      }
      finish(() =>
        reject(
          createError('EWEBASSEMBLY', `${operation} worker response was invalid`)
        )
      );
    };
    worker.onerror = (event) => {
      finish(() =>
        reject(
          createError(
            'EWEBASSEMBLY',
            event.message || `${operation} worker failed to load`
          )
        )
      );
    };
    worker.onmessageerror = () => {
      finish(() =>
        reject(
          createError(
            'EWEBASSEMBLY',
            `${operation} worker response was invalid`
          )
        )
      );
    };

    try {
      worker.postMessage({
        operation,
        oldFileData,
        inputFileData,
        maxInputBytes: options.maxInputBytes,
        maxOutputBytes: options.maxOutputBytes,
      });
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

async function runWorker(operation, oldInput, input, options = {}) {
  if (typeof Worker === 'undefined') {
    throw createError(
      'EUNSUPPORTED',
      'Web Workers are required to run react-native-bs-diff-patch on Web'
    );
  }

  validateOperationOptions(options);
  if (options.signal?.aborted) {
    throw createError('EABORTED', `${operation} was aborted`);
  }

  const oldInputBytes = inputByteLength(oldInput);
  const inputBytes = inputByteLength(input);
  if (oldInputBytes === undefined) {
    throw createError(
      'EINVAL',
      'oldData must be an ArrayBuffer, ArrayBufferView, or Blob'
    );
  }
  if (inputBytes === undefined) {
    throw createError(
      'EINVAL',
      `${
        operation === 'diff' ? 'newData' : 'patchData'
      } must be an ArrayBuffer, ArrayBufferView, or Blob`
    );
  }
  enforceLimit(oldInputBytes, options.maxInputBytes, 'oldData');
  enforceLimit(
    inputBytes,
    options.maxInputBytes,
    operation === 'diff' ? 'newData' : 'patchData'
  );

  if (operation === 'patch' && options.maxOutputBytes !== undefined) {
    const { bytes, patchBytes } = await readPatchHeader(input);
    const { targetBytes: declaredOutputSize } = decodePatchMetadata(
      bytes,
      patchBytes
    );
    if (
      declaredOutputSize !== undefined &&
      declaredOutputSize > BigInt(options.maxOutputBytes)
    ) {
      throw createError(
        'ERESOURCE',
        `output exceeds the configured ${options.maxOutputBytes} byte limit`
      );
    }
  }

  return options.signal
    ? runDedicatedWorker(operation, oldInput, input, options)
    : runSharedWorker(operation, oldInput, input, options);
}

function rejectPathApi(methodName, webMethodName = `${methodName}Bytes`) {
  return Promise.reject(
    createError(
      'EUNSUPPORTED',
      `${methodName} uses native file paths and is not available on Web; use ${webMethodName} instead`
    )
  );
}

export function diff() {
  return rejectPathApi('diff');
}

export function patch() {
  return rejectPathApi('patch');
}

export function diffBytes(oldData, newData, options) {
  return runWorker('diff', oldData, newData, options);
}

export function patchBytes(oldData, patchData, options) {
  return runWorker('patch', oldData, patchData, options);
}

export async function inspectPatch(patchData, options = {}) {
  validateOperationOptions(options);
  const observedBytes = inputByteLength(patchData);
  if (observedBytes !== undefined) {
    enforceLimit(observedBytes, options.maxInputBytes, 'patchData');
  }
  const { bytes, patchBytes } = await readPatchHeader(patchData);
  enforceLimit(patchBytes, options.maxInputBytes, 'patchData');
  return decodePatchMetadata(bytes, patchBytes).metadata;
}

export async function verifyPatch(
  oldData,
  patchData,
  expectedData,
  options = {}
) {
  validateOperationOptions(options);
  if (options.signal?.aborted) {
    throw createError('EABORTED', 'verify was aborted');
  }
  const expectedByteLength = inputByteLength(expectedData);
  if (expectedByteLength === undefined) {
    throw createError(
      'EINVAL',
      'expectedData must be an ArrayBuffer, ArrayBufferView, or Blob'
    );
  }
  enforceLimit(expectedByteLength, options.maxInputBytes, 'expectedData');
  const metadata = await inspectPatch(patchData, {
    maxInputBytes: options.maxInputBytes,
  });
  if (!metadata.valid) {
    throw createError(
      'EPATCH',
      `patch structure is invalid: ${metadata.issue || 'UNKNOWN'}`
    );
  }
  const [expectedBytes, restoredBytes] = await Promise.all([
    toUint8Array(expectedData, 'expectedData'),
    patchBytes(oldData, patchData, options),
  ]);
  if (options.signal?.aborted) {
    throw createError('EABORTED', 'verify was aborted');
  }
  enforceLimit(expectedBytes.byteLength, options.maxInputBytes, 'expectedData');
  let verified = restoredBytes.byteLength === expectedBytes.byteLength;
  for (
    let index = 0;
    verified && index < restoredBytes.byteLength;
    index += 1
  ) {
    verified = restoredBytes[index] === expectedBytes[index];
  }
  return {
    expectedBytes: expectedBytes.byteLength,
    patch: metadata,
    restoredBytes: restoredBytes.byteLength,
    verified,
  };
}

let binaryJobId = 0;

function createBinaryJob(operation, oldData, inputData, options = {}) {
  validateOperationOptions(options);
  const id = `bsdiffpatch-web-${Date.now().toString(36)}-${++binaryJobId}`;
  const controller = new AbortController();
  const listeners = new Set();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (options.signal?.aborted) {
    controller.abort();
  }
  const run = operation === 'diff' ? diffBytes : patchBytes;
  const result = run(oldData, inputData, {
    ...options,
    signal: controller.signal,
    onProgress(progress) {
      options.onProgress?.(progress);
      const event = { ...progress, id };
      for (const listener of listeners) {
        listener(event);
      }
    },
  }).finally(() => {
    options.signal?.removeEventListener('abort', abortFromCaller);
    listeners.clear();
  });

  return {
    id,
    result,
    async cancel() {
      controller.abort();
      await result.catch(() => undefined);
    },
    onProgress(listener) {
      if (typeof listener !== 'function') {
        throw createError('EINVAL', 'progress listener must be a function');
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function startDiff(oldData, newData, options) {
  return createBinaryJob('diff', oldData, newData, options);
}

export function startPatch(oldData, patchData, options) {
  return createBinaryJob('patch', oldData, patchData, options);
}

export function startDiffBytes(oldData, newData, options) {
  return createBinaryJob('diff', oldData, newData, options);
}

export function startPatchBytes(oldData, patchData, options) {
  return createBinaryJob('patch', oldData, patchData, options);
}
