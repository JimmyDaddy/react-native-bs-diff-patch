import { runOperation } from './operations.browser.mjs';

let operationQueue = Promise.resolve();

function serializeError(error) {
  return {
    code: error && error.code ? error.code : 'EWEBASSEMBLY',
    message:
      error instanceof Error
        ? error.message
        : String(error || 'unknown WebAssembly error'),
  };
}

async function runRequest(message) {
  const { id, operation, oldFileData, inputFileData, maxInputBytes, maxOutputBytes } =
    message || {};
  try {
    if (operation !== 'diff' && operation !== 'patch') {
      const error = new Error('worker operation must be diff or patch');
      error.code = 'EINVAL';
      throw error;
    }
    const output = await runOperation(operation, oldFileData, inputFileData, {
      maxInputBytes,
      maxOutputBytes,
      onProgress: (progress) => {
        self.postMessage({ id, type: 'progress', progress });
      },
    });
    self.postMessage({ id, type: 'result', ok: true, output }, [output.buffer]);
  } catch (error) {
    self.postMessage({
      id,
      type: 'result',
      ok: false,
      error: serializeError(error),
    });
  }
}

self.onmessage = (event) => {
  const message = event.data;
  operationQueue = operationQueue
    .catch(() => undefined)
    .then(() => runRequest(message));
};
