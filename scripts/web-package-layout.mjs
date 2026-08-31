import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
export const sourcePackageDirectory = path.join(
  repositoryDirectory,
  'packages',
  'web'
);
export const stagingPackageDirectory = path.join(
  repositoryDirectory,
  'build',
  'web-package'
);

export const runtimeFiles = [
  'index.mjs',
  'index.d.mts',
  'web/index.mjs',
  'web/worker.browser.mjs',
  'web/operations.browser.mjs',
  'web/operation-runtime.mjs',
  'web/bsdiffpatch.browser.mjs',
  'web/index.d.mts',
  'toolkit/index.mjs',
  'toolkit/index.d.ts',
];

export const webRuntimeModuleFiles = [
  'index.mjs',
  'web/index.mjs',
  'web/worker.browser.mjs',
  'web/operations.browser.mjs',
  'web/operation-runtime.mjs',
  'web/bsdiffpatch.browser.mjs',
];

export const packageFileMappings = [
  { from: 'packages/web/index.mjs', to: 'index.mjs' },
  { from: 'packages/web/index.d.mts', to: 'index.d.mts' },
  ...runtimeFiles
    .filter(
      (relative) =>
        relative.startsWith('web/') || relative.startsWith('toolkit/')
    )
    .map((relative) => ({ from: relative, to: relative })),
  { from: 'LICENSE', to: 'LICENSE' },
  {
    from: 'packages/web/THIRD_PARTY_NOTICES.txt',
    to: 'THIRD_PARTY_NOTICES.txt',
  },
  { from: 'packages/web/README.md', to: 'README.md' },
  { from: 'packages/web/README.zh-CN.md', to: 'README.zh-CN.md' },
];

export const stagedPackageFiles = [
  'LICENSE',
  'THIRD_PARTY_NOTICES.txt',
  'README.md',
  'README.zh-CN.md',
  'package.json',
  ...runtimeFiles,
].sort();

export const packageExports = {
  '.': {
    types: './index.d.mts',
    import: './index.mjs',
    default: './index.mjs',
  },
  './toolkit': {
    types: './toolkit/index.d.ts',
    import: './toolkit/index.mjs',
    default: './toolkit/index.mjs',
  },
  './package.json': './package.json',
};
