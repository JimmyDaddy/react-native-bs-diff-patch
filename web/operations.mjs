import createBsDiffPatchModule from './bsdiffpatch.mjs';

const OLD_FILE = '/old-file';
const INPUT_FILE = '/input-file';
const OUTPUT_FILE = '/output-file';
const PATCH_MAGIC = new Uint8Array([
  69, 78, 68, 83, 76, 69, 89, 47, 66, 83, 68, 73, 70, 70, 52, 51,
]);

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
}

function createOperationError(operation, error) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : String(error || 'unknown WebAssembly error');
  const wrapped = new Error(`${operation} failed: ${message}`);
  wrapped.code = 'EWEBASSEMBLY';
  return wrapped;
}

export async function runOperation(operation, oldFileData, inputFileData) {
  try {
    if (operation === 'patch') {
      validatePatchHeader(inputFileData);
    }

    const module = await createBsDiffPatchModule({
      print: () => {},
      printErr: () => {},
    });

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

    return module.FS.readFile(OUTPUT_FILE).slice();
  } catch (error) {
    throw createOperationError(operation, error);
  }
}
