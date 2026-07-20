const mockPatch = jest.fn<Promise<number>, [string, string, string]>(() =>
  Promise.resolve(0)
);
const mockDiff = jest.fn<Promise<number>, [string, string, string]>(() =>
  Promise.resolve(0)
);
const mockStartDiff = jest.fn<
  Promise<number>,
  [string, string, string, string, number, number]
>(() => Promise.resolve(0));
const mockStartPatch = jest.fn<
  Promise<number>,
  [string, string, string, string, number, number]
>(() => Promise.resolve(0));
const mockCancel = jest.fn<Promise<boolean>, [string]>(() =>
  Promise.resolve(true)
);
const validMetadata = {
  declaredTargetBytes: '7',
  format: 'ENDSLEY/BSDIFF43',
  headerBytes: 24,
  patchBytes: 42,
  payloadBytes: 18,
  valid: true,
} as const;
const mockInspectPatch = jest.fn<Promise<string>, [string, number]>(() =>
  Promise.resolve(JSON.stringify(validMetadata))
);
const mockVerifyPatch = jest.fn<
  Promise<string>,
  [string, string, string, number, number]
>(() =>
  Promise.resolve(
    JSON.stringify({
      expectedBytes: 7,
      patch: validMetadata,
      restoredBytes: 7,
      verified: true,
    })
  )
);

jest.mock('../NativeBsDiffPatch', () => ({
  patch: (oldFile: string, newFile: string, patchFile: string) =>
    mockPatch(oldFile, newFile, patchFile),
  diff: (oldFile: string, newFile: string, patchFile: string) =>
    mockDiff(oldFile, newFile, patchFile),
  inspectPatch: (patchFile: string, maxInputBytes: number) =>
    mockInspectPatch(patchFile, maxInputBytes),
  verifyPatch: (
    oldFile: string,
    patchFile: string,
    expectedFile: string,
    maxInputBytes: number,
    maxOutputBytes: number
  ) =>
    mockVerifyPatch(
      oldFile,
      patchFile,
      expectedFile,
      maxInputBytes,
      maxOutputBytes
    ),
  startDiff: (
    id: string,
    oldFile: string,
    newFile: string,
    patchFile: string,
    maxInputBytes: number,
    maxOutputBytes: number
  ) =>
    mockStartDiff(
      id,
      oldFile,
      newFile,
      patchFile,
      maxInputBytes,
      maxOutputBytes
    ),
  startPatch: (
    id: string,
    oldFile: string,
    newFile: string,
    patchFile: string,
    maxInputBytes: number,
    maxOutputBytes: number
  ) =>
    mockStartPatch(
      id,
      oldFile,
      newFile,
      patchFile,
      maxInputBytes,
      maxOutputBytes
    ),
  cancel: (id: string) => mockCancel(id),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
}));

import {
  diff,
  diffBytes,
  inspectPatch,
  patch,
  patchBytes,
  startDiff,
  startPatch,
  verifyPatch,
} from '../index';
import { NativeEventEmitter } from 'react-native';

describe('BsDiffPatch TurboModule facade', () => {
  beforeEach(() => {
    mockDiff.mockClear();
    mockPatch.mockClear();
    mockStartDiff.mockClear();
    mockStartPatch.mockClear();
    mockCancel.mockClear();
    mockInspectPatch.mockClear();
    mockVerifyPatch.mockClear();
  });

  it('delegates diff arguments and result', async () => {
    await expect(diff('old', 'new', 'patch')).resolves.toBe(0);
    expect(mockDiff).toHaveBeenCalledWith('old', 'new', 'patch');
  });

  it('delegates patch arguments and result', async () => {
    await expect(patch('old', 'new', 'patch')).resolves.toBe(0);
    expect(mockPatch).toHaveBeenCalledWith('old', 'new', 'patch');
  });

  it.each([
    ['diffBytes', diffBytes],
    ['patchBytes', patchBytes],
  ] as const)('rejects Web-only %s on native', async (_, operation) => {
    await expect(
      operation(new Uint8Array([1]), new Uint8Array([2]))
    ).rejects.toMatchObject({ code: 'EUNSUPPORTED' });
  });

  it.each([
    ['diff', startDiff, mockStartDiff],
    ['patch', startPatch, mockStartPatch],
  ] as const)(
    'creates a controllable native %s job',
    async (_, start, nativeStart) => {
      const job = start('old', 'new', 'patch', {
        maxInputBytes: 1024,
        maxOutputBytes: 2048,
      });

      expect(job.id).toMatch(/^bsdiffpatch-/);
      await expect(job.result).resolves.toBe(0);
      expect(nativeStart).toHaveBeenCalledWith(
        job.id,
        'old',
        'new',
        'patch',
        1024,
        2048
      );

      await job.cancel();
      expect(mockCancel).toHaveBeenCalledWith(job.id);
    }
  );

  it('rejects invalid native limits before starting a job', () => {
    expect(() =>
      startPatch('old', 'new', 'patch', { maxInputBytes: 0 })
    ).toThrow('maxInputBytes must be a positive safe integer');
    expect(mockStartPatch).not.toHaveBeenCalled();
  });

  it('inspects native patch metadata and preserves exact target bytes', async () => {
    await expect(
      inspectPatch('release.patch', { maxInputBytes: 1024 })
    ).resolves.toEqual(validMetadata);
    expect(mockInspectPatch).toHaveBeenCalledWith('release.patch', 1024);
  });

  it('verifies native paths through a temporary output', async () => {
    await expect(
      verifyPatch('old.bin', 'release.patch', 'expected.bin', {
        maxInputBytes: 1024,
        maxOutputBytes: 2048,
      })
    ).resolves.toMatchObject({ verified: true, restoredBytes: 7 });
    expect(mockVerifyPatch).toHaveBeenCalledWith(
      'old.bin',
      'release.patch',
      'expected.bin',
      1024,
      2048
    );
  });

  it('rejects binary metadata inputs on native', async () => {
    await expect(inspectPatch(new Uint8Array([1]))).rejects.toMatchObject({
      code: 'EUNSUPPORTED',
    });
    await expect(
      verifyPatch(new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3]))
    ).rejects.toMatchObject({ code: 'EUNSUPPORTED' });
  });

  it('filters progress by job and returns a working unsubscribe function', () => {
    const remove = jest.fn();
    const addListener = jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockReturnValue({ remove } as never);
    const listener = jest.fn();
    const job = startDiff('old', 'new', 'patch');
    const unsubscribe = job.onProgress(listener);
    const emit = addListener.mock.calls[0]?.[1] as (
      event: Omit<import('../index').NativeOperationProgress, 'operation'>
    ) => void;

    emit({ id: 'another-job', phase: 'reading', progress: 0.1 });
    emit({ id: job.id, phase: 'processing', progress: 0.5 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      id: job.id,
      operation: 'diff',
      phase: 'processing',
      progress: 0.5,
    });
    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
    addListener.mockRestore();
  });
});
