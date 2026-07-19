import createBsDiffPatchModule from './bsdiffpatch.mjs';

const OLD_FILE = '/old-file';
const INPUT_FILE = '/input-file';
const OUTPUT_FILE = '/output-file';
const PATCH_MAGIC = new Uint8Array([
  69, 78, 68, 83, 76, 69, 89, 47, 66, 83, 68, 73, 70, 70, 52, 51,
]);
let modulePromise;

function getModule() {
  if (!modulePromise) {
    const pendingModule = createBsDiffPatchModule({
      print: () => {},
      printErr: () => {},
    });
    modulePromise = pendingModule;
    pendingModule.catch(() => {
      if (modulePromise === pendingModule) {
        modulePromise = undefined;
      }
    });
  }
  return modulePromise;
}

function removeFile(module, filePath) {
  try {
    module.FS.unlink(filePath);
  } catch {
    // The operation may have failed before creating every MEMFS file.
  }
}

function validatePatchHeader(patchData) {
  if (patchData.byteLength < 24) {
    throw new Error('corrupt patch header');
  }

  for (let index = 0; index < PATCH_MAGIC.length; index += 1) {
    if (patchData[index] !== PATCH_MAGIC[index]) {
      throw new Error('corrupt patch signature');
    }
  }

  if ((patchData[23] & 0x80) !== 0) {
    throw new Error('corrupt patch output size');
  }

  let outputSize = 0n;
  for (let index = 23; index >= 16; index -= 1) {
    outputSize = outputSize * 256n + BigInt(patchData[index]);
  }
  return outputSize;
}

function enforceOutputLimit(outputSize, maxOutputBytes) {
  if (maxOutputBytes !== undefined && outputSize > BigInt(maxOutputBytes)) {
    const error = new Error(
      `output exceeds the configured ${maxOutputBytes} byte limit`
    );
    error.code = 'ERESOURCE';
    throw error;
  }
}

function createOperationError(operation, error) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : String(error || 'unknown WebAssembly error');
  const wrapped = new Error(`${operation} failed: ${message}`);
  wrapped.code = error && error.code ? error.code : 'EWEBASSEMBLY';
  return wrapped;
}

export async function runOperation(
  operation,
  oldFileData,
  inputFileData,
  options = {}
) {
  try {
    if (operation === 'patch') {
      const outputSize = validatePatchHeader(inputFileData);
      enforceOutputLimit(outputSize, options.maxOutputBytes);
    }

    const module = await getModule();

    try {
      module.FS.writeFile(OLD_FILE, oldFileData);
      module.FS.writeFile(INPUT_FILE, inputFileData);

      const functionName = operation === 'diff' ? 'bsDiffFile' : 'bsPatchFile';
      const args =
        operation === 'diff'
          ? [OLD_FILE, INPUT_FILE, OUTPUT_FILE]
          : [OLD_FILE, OUTPUT_FILE, INPUT_FILE];
      const result = module.ccall(
        functionName,
        'number',
        ['string', 'string', 'string'],
        args
      );

      if (result !== 0) {
        throw new Error(`native function returned ${result}`);
      }

      const output = module.FS.readFile(OUTPUT_FILE).slice();
      enforceOutputLimit(BigInt(output.byteLength), options.maxOutputBytes);
      return output;
    } finally {
      removeFile(module, OLD_FILE);
      removeFile(module, INPUT_FILE);
      removeFile(module, OUTPUT_FILE);
    }
  } catch (error) {
    throw createOperationError(operation, error);
  }
}
