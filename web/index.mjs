function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateLimit(value, fieldName) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw createError(
      'EINVAL',
      `${fieldName} must be a non-negative safe integer`
    );
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

function patchOutputSize(patchData) {
  if (patchData.byteLength < 24) {
    return undefined;
  }
  let outputSize = 0n;
  for (let index = 23; index >= 16; index -= 1) {
    if (index === 23 && (patchData[index] & 0x80) !== 0) {
      return undefined;
    }
    outputSize = outputSize * 256n + BigInt(patchData[index]);
  }
  return outputSize;
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

  sharedWorker = new Worker(new URL('./worker.mjs', import.meta.url), {
    type: 'module',
  });
  sharedWorker.onmessage = (event) => {
    const request = sharedRequests.get(event.data && event.data.id);
    if (!request) {
      return;
    }
    sharedRequests.delete(event.data.id);

    if (event.data.ok) {
      try {
        enforceLimit(
          event.data.output.byteLength,
          request.maxOutputBytes,
          'output'
        );
        request.resolve(event.data.output);
      } catch (error) {
        request.reject(error);
      }
      return;
    }
    request.reject(responseError(request.operation, event.data.error));
  };
  sharedWorker.onerror = (event) => {
    resetSharedWorker(
      createError(
        'EWEBASSEMBLY',
        event.message || 'Shared Web Worker failed to load'
      )
    );
  };
  sharedWorker.onmessageerror = () => {
    resetSharedWorker(
      createError('EWEBASSEMBLY', 'Shared Web Worker response was invalid')
    );
  };
  return sharedWorker;
}

function runSharedWorker(operation, oldFileData, inputFileData, options) {
  const worker = getSharedWorker();
  const id = ++sharedRequestId;

  return new Promise((resolve, reject) => {
    sharedRequests.set(id, {
      maxOutputBytes: options.maxOutputBytes,
      operation,
      reject,
      resolve,
    });
    try {
      worker.postMessage(
        {
          id,
          operation,
          oldFileData,
          inputFileData,
          maxOutputBytes: options.maxOutputBytes,
        },
        [oldFileData.buffer, inputFileData.buffer]
      );
    } catch (error) {
      sharedRequests.delete(id);
      reject(error);
    }
  });
}

function runDedicatedWorker(operation, oldFileData, inputFileData, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
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
      if (event.data && event.data.ok) {
        const output = event.data.output;
        try {
          enforceLimit(output.byteLength, options.maxOutputBytes, 'output');
          finish(() => resolve(output));
        } catch (error) {
          finish(() => reject(error));
        }
        return;
      }

      finish(() =>
        reject(responseError(operation, event.data && event.data.error))
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
      worker.postMessage(
        {
          operation,
          oldFileData,
          inputFileData,
          maxOutputBytes: options.maxOutputBytes,
        },
        [oldFileData.buffer, inputFileData.buffer]
      );
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

  validateLimit(options.maxInputBytes, 'maxInputBytes');
  validateLimit(options.maxOutputBytes, 'maxOutputBytes');
  if (options.signal?.aborted) {
    throw createError('EABORTED', `${operation} was aborted`);
  }

  const oldInputBytes = inputByteLength(oldInput);
  const inputBytes = inputByteLength(input);
  if (oldInputBytes !== undefined) {
    enforceLimit(oldInputBytes, options.maxInputBytes, 'oldData');
  }
  if (inputBytes !== undefined) {
    enforceLimit(
      inputBytes,
      options.maxInputBytes,
      operation === 'diff' ? 'newData' : 'patchData'
    );
  }

  const [oldFileData, inputFileData] = await Promise.all([
    toUint8Array(oldInput, 'oldData'),
    toUint8Array(input, operation === 'diff' ? 'newData' : 'patchData'),
  ]);

  if (operation === 'patch' && options.maxOutputBytes !== undefined) {
    const declaredOutputSize = patchOutputSize(inputFileData);
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
    ? runDedicatedWorker(operation, oldFileData, inputFileData, options)
    : runSharedWorker(operation, oldFileData, inputFileData, options);
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

let unsupportedNativeJobId = 0;

function unsupportedNativeJob(methodName) {
  const id = `bsdiffpatch-web-unsupported-${++unsupportedNativeJobId}`;
  return {
    id,
    result: rejectPathApi(
      methodName,
      methodName === 'startDiff' ? 'diffBytes' : 'patchBytes'
    ),
    async cancel() {},
    onProgress() {
      return () => {};
    },
  };
}

export function startDiff() {
  return unsupportedNativeJob('startDiff');
}

export function startPatch() {
  return unsupportedNativeJob('startPatch');
}
