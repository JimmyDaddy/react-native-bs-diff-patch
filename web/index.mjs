function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
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

async function runWorker(operation, oldInput, input) {
  if (typeof Worker === 'undefined') {
    throw createError(
      'EUNSUPPORTED',
      'Web Workers are required to run react-native-bs-diff-patch on Web'
    );
  }

  const [oldFileData, inputFileData] = await Promise.all([
    toUint8Array(oldInput, 'oldData'),
    toUint8Array(input, operation === 'diff' ? 'newData' : 'patchData'),
  ]);

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
      worker.terminate();
      callback();
    };

    worker.onmessage = (event) => {
      if (event.data && event.data.ok) {
        finish(() => resolve(event.data.output));
        return;
      }

      const workerError = event.data && event.data.error;
      finish(() =>
        reject(
          createError(
            workerError && workerError.code ? workerError.code : 'EWEBASSEMBLY',
            workerError && workerError.message
              ? workerError.message
              : `${operation} worker failed`
          )
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

    worker.postMessage({ operation, oldFileData, inputFileData }, [
      oldFileData.buffer,
      inputFileData.buffer,
    ]);
  });
}

function rejectPathApi(methodName) {
  return Promise.reject(
    createError(
      'EUNSUPPORTED',
      `${methodName} uses native file paths and is not available on Web; use ${methodName}Bytes instead`
    )
  );
}

export function diff() {
  return rejectPathApi('diff');
}

export function patch() {
  return rejectPathApi('patch');
}

export function diffBytes(oldData, newData) {
  return runWorker('diff', oldData, newData);
}

export function patchBytes(oldData, patchData) {
  return runWorker('patch', oldData, patchData);
}
