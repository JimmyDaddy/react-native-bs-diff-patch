import { runOperation } from './operations.mjs';

let operationQueue = Promise.resolve();

self.onmessage = (event) => {
  const { id, operation, oldFileData, inputFileData, maxOutputBytes } =
    event.data;

  operationQueue = operationQueue.then(async () => {
    try {
      const output = await runOperation(operation, oldFileData, inputFileData, {
        maxOutputBytes,
      });
      self.postMessage({ id, ok: true, output }, [output.buffer]);
    } catch (error) {
      self.postMessage({
        id,
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
