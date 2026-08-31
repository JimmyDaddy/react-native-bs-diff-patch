const PATCH_MAGIC = new Uint8Array([
  69, 78, 68, 83, 76, 69, 89, 47, 66, 83, 68, 73, 70, 70, 52, 51,
]);
const PHASE_NAMES = ['reading', 'processing', 'writing'];
const OLD_FILE = '/old-file';
const INPUT_FILE = '/input-file';
const OUTPUT_FILE = '/output-file';

function createRuntimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw createRuntimeError('EINVAL', 'operation input must be binary data');
}

function isBlob(input) {
  return typeof Blob !== 'undefined' && input instanceof Blob;
}

function inputByteLength(input) {
  return isBlob(input) ? input.size : toUint8Array(input).byteLength;
}

function validateLimit(value, fieldName) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw createRuntimeError(
      'EINVAL',
      `${fieldName} must be a non-negative safe integer`
    );
  }
}

function validateOptions(options) {
  if (options === null || typeof options !== 'object') {
    throw createRuntimeError('EINVAL', 'operation options must be an object');
  }
  validateLimit(options.maxInputBytes, 'maxInputBytes');
  validateLimit(options.maxOutputBytes, 'maxOutputBytes');
}

function enforceInputLimit(input, maximumBytes, fieldName) {
  const actualBytes = inputByteLength(input);
  if (maximumBytes !== undefined && actualBytes > maximumBytes) {
    throw createRuntimeError(
      'ERESOURCE',
      `${fieldName} is ${actualBytes} bytes and exceeds the ${maximumBytes} byte limit`
    );
  }
}

async function patchHeader(input) {
  if (isBlob(input)) {
    return new Uint8Array(await input.slice(0, 24).arrayBuffer());
  }
  return toUint8Array(input).subarray(0, 24);
}

function validatePatchHeader(patchData) {
  if (patchData.byteLength < 24) {
    throw createRuntimeError('EPATCH', 'corrupt patch header');
  }
  for (let index = 0; index < PATCH_MAGIC.length; index += 1) {
    if (patchData[index] !== PATCH_MAGIC[index]) {
      throw createRuntimeError('EPATCH', 'corrupt patch signature');
    }
  }
  if ((patchData[23] & 0x80) !== 0) {
    throw createRuntimeError('EPATCH', 'corrupt patch output size');
  }

  let outputSize = 0n;
  for (let index = 23; index >= 16; index -= 1) {
    outputSize = outputSize * 256n + BigInt(patchData[index]);
  }
  return outputSize;
}

function enforceOutputLimit(outputSize, maxOutputBytes) {
  if (maxOutputBytes !== undefined && outputSize > BigInt(maxOutputBytes)) {
    throw createRuntimeError(
      'ERESOURCE',
      `output exceeds the configured ${maxOutputBytes} byte limit`
    );
  }
}

export function classifyRuntimeErrorCode(error, message) {
  if (error && error.code) {
    return error.code;
  }
  if (
    /out of memory|memory access out of bounds|cannot enlarge memory|oom/i.test(
      message
    )
  ) {
    return 'ERESOURCE';
  }
  return 'EWEBASSEMBLY';
}

function operationResultError(result) {
  const codes = new Map([
    [-2, 'ERESOURCE'],
    [-3, 'ERESOURCE'],
    [-4, 'EABORTED'],
    [-5, 'EDESTEXISTS'],
    [-6, 'EINVAL'],
  ]);
  return createRuntimeError(
    codes.get(result) || 'EWEBASSEMBLY',
    `native function returned ${result}`
  );
}

export function createOperationRuntime(createBsDiffPatchModule) {
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

  function prepareInput(module, input, memoryPath, mountPath) {
    if (!isBlob(input)) {
      module.FS.writeFile(memoryPath, toUint8Array(input));
      return {
        path: memoryPath,
        cleanup() {
          removeFile(module, memoryPath);
        },
      };
    }

    module.FS.mkdir(mountPath);
    module.FS.mount(
      module.WORKERFS,
      { blobs: [{ data: input, name: 'input' }] },
      mountPath
    );
    return {
      path: `${mountPath}/input`,
      cleanup() {
        try {
          module.FS.unmount(mountPath);
        } finally {
          try {
            module.FS.rmdir(mountPath);
          } catch {
            // A failed mount may already have removed the directory.
          }
        }
      },
    };
  }

  function wrapOperationError(operation, error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : String(error || 'unknown WebAssembly error');
    return createRuntimeError(
      classifyRuntimeErrorCode(error, message),
      `${operation} failed: ${message}`
    );
  }

  async function runOperation(
    operation,
    oldFileData,
    inputFileData,
    options = {}
  ) {
    try {
      validateOptions(options);
      enforceInputLimit(oldFileData, options.maxInputBytes, 'oldData');
      enforceInputLimit(
        inputFileData,
        options.maxInputBytes,
        operation === 'diff' ? 'newData' : 'patchData'
      );
      if (
        operation === 'diff' &&
        options.maxOutputBytes !== undefined &&
        options.maxOutputBytes < 24
      ) {
        throw createRuntimeError(
          'ERESOURCE',
          `output exceeds the configured ${options.maxOutputBytes} byte limit`
        );
      }
      if (operation === 'patch') {
        enforceOutputLimit(
          validatePatchHeader(await patchHeader(inputFileData)),
          options.maxOutputBytes
        );
      }

      const module = await getModule();
      let oldInput;
      let operationInput;
      try {
        oldInput = prepareInput(module, oldFileData, OLD_FILE, '/old-input');
        operationInput = prepareInput(
          module,
          inputFileData,
          INPUT_FILE,
          '/operation-input'
        );
        module.onProgress = (phase, progress) => {
          options.onProgress?.({
            operation,
            phase: PHASE_NAMES[phase] || 'processing',
            progress: Math.max(0, Math.min(1, progress)),
          });
        };
        const functionName =
          operation === 'diff'
            ? 'bsDiffFileWithProgressAndLimits'
            : 'bsPatchFileWithProgressAndLimits';
        const fileArgs =
          operation === 'diff'
            ? [oldInput.path, operationInput.path, OUTPUT_FILE]
            : [oldInput.path, OUTPUT_FILE, operationInput.path];
        const result = module.ccall(
          functionName,
          'number',
          ['string', 'string', 'string', 'number', 'number'],
          [
            ...fileArgs,
            options.maxInputBytes ?? -1,
            options.maxOutputBytes ?? -1,
          ]
        );
        if (result !== 0) {
          throw operationResultError(result);
        }

        const output = module.FS.readFile(OUTPUT_FILE).slice();
        enforceOutputLimit(BigInt(output.byteLength), options.maxOutputBytes);
        return output;
      } finally {
        module.onProgress = undefined;
        operationInput?.cleanup();
        oldInput?.cleanup();
        removeFile(module, OUTPUT_FILE);
      }
    } catch (error) {
      throw wrapOperationError(operation, error);
    }
  }

  async function convertBsdiff40(inputFileData) {
    let input;
    try {
      const module = await getModule();
      input = prepareInput(module, inputFileData, INPUT_FILE, '/operation-input');
      const result = module.ccall(
        'bsConvertBsdiff40File',
        'number',
        ['string', 'string'],
        [input.path, OUTPUT_FILE]
      );
      if (result !== 0) {
        throw createRuntimeError(
          'ELEGACYFORMAT',
          `converter returned ${result}`
        );
      }
      return module.FS.readFile(OUTPUT_FILE).slice();
    } catch (error) {
      throw wrapOperationError('BSDIFF40 conversion', error);
    } finally {
      const module = await modulePromise?.catch(() => undefined);
      if (module) {
        input?.cleanup();
        removeFile(module, OUTPUT_FILE);
      }
    }
  }

  return { convertBsdiff40, runOperation };
}
