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

jest.mock('../NativeBsDiffPatch', () => ({
  patch: (oldFile: string, newFile: string, patchFile: string) =>
    mockPatch(oldFile, newFile, patchFile),
  diff: (oldFile: string, newFile: string, patchFile: string) =>
    mockDiff(oldFile, newFile, patchFile),
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
  patch,
  patchBytes,
  startDiff,
  startPatch,
} from '../index';
import { NativeEventEmitter } from 'react-native';

describe('BsDiffPatch TurboModule facade', () => {
  beforeEach(() => {
    mockDiff.mockClear();
    mockPatch.mockClear();
    mockStartDiff.mockClear();
    mockStartPatch.mockClear();
    mockCancel.mockClear();
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
