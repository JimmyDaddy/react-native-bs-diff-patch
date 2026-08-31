import { runOperation } from './operations.mjs';

let operationQueue = Promise.resolve();

self.onmessage = (event) => {
  const { id, operation, oldFileData, inputFileData, maxOutputBytes } =
    event.data;

  operationQueue = operationQueue.then(async () => {
    try {
      const output = await runOperation(operation, oldFileData, inputFileData, {
        maxOutputBytes,
        onProgress: (progress) => {
          self.postMessage({ id, type: 'progress', progress });
        },
      });
      self.postMessage({ id, type: 'result', ok: true, output }, [
        output.buffer,
      ]);
    } catch (error) {
      self.postMessage({
        id,
        type: 'result',
        ok: false,
        error: {
          code: error && error.code ? error.code : 'EWEBASSEMBLY',
          message:
            error instanceof Error
              ? error.message
              : String(error || 'unknown error'),
        },
      });
    }
  });
};
