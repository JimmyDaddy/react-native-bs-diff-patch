const mockPatch = jest.fn<Promise<number>, [string, string, string]>(() =>
  Promise.resolve(0)
);
const mockDiff = jest.fn<Promise<number>, [string, string, string]>(() =>
  Promise.resolve(0)
);

jest.mock('../NativeBsDiffPatch', () => ({
  patch: (oldFile: string, newFile: string, patchFile: string) =>
    mockPatch(oldFile, newFile, patchFile),
  diff: (oldFile: string, newFile: string, patchFile: string) =>
    mockDiff(oldFile, newFile, patchFile),
}));

import { diff, diffBytes, patch, patchBytes } from '../index';

describe('BsDiffPatch TurboModule facade', () => {
  beforeEach(() => {
    mockDiff.mockClear();
    mockPatch.mockClear();
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
});
