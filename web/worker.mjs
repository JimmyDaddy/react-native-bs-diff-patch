import { runOperation } from './operations.mjs';

self.onmessage = async (event) => {
  const { operation, oldFileData, inputFileData } = event.data;

  try {
    const output = await runOperation(operation, oldFileData, inputFileData);
    self.postMessage({ ok: true, output }, [output.buffer]);
  } catch (error) {
    self.postMessage({
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
};
