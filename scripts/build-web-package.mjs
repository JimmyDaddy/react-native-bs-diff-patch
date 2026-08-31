import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  packageExports,
  packageFileMappings,
  repositoryDirectory,
  sourcePackageDirectory,
  stagingPackageDirectory,
} from './web-package-layout.mjs';

const refuseSourcePack = process.argv.includes('--refuse-source-pack');

if (refuseSourcePack) {
  throw new Error(
    'packages/web is a private package template. Run node scripts/build-web-package.mjs, then cd build/web-package && npm pack.'
  );
}

const sourceManifest = JSON.parse(
  await readFile(path.join(sourcePackageDirectory, 'package.json'), 'utf8')
);

if (sourceManifest.private !== true) {
  throw new Error('packages/web/package.json must remain private');
}
if (sourceManifest.name !== 'bs-diff-patch-web') {
  throw new Error('packages/web/package.json must name bs-diff-patch-web');
}

const stagingManifest = {
  name: sourceManifest.name,
  version: sourceManifest.version,
  description: sourceManifest.description,
  license: sourceManifest.license,
  type: 'module',
  types: './index.d.mts',
  exports: packageExports,
  files: [
    'index.mjs',
    'index.d.mts',
    'web',
    'toolkit',
    'LICENSE',
    'THIRD_PARTY_NOTICES.txt',
    'README.md',
    'README.zh-CN.md',
  ],
  keywords: sourceManifest.keywords,
  repository: sourceManifest.repository,
  bugs: sourceManifest.bugs,
  homepage: sourceManifest.homepage,
  publishConfig: sourceManifest.publishConfig,
};

await rm(stagingPackageDirectory, { recursive: true, force: true });
await mkdir(stagingPackageDirectory, { recursive: true });

for (const mapping of packageFileMappings) {
  const source = path.join(repositoryDirectory, mapping.from);
  const destination = path.join(stagingPackageDirectory, mapping.to);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

await writeFile(
  path.join(stagingPackageDirectory, 'package.json'),
  `${JSON.stringify(stagingManifest, null, 2)}\n`
);

console.log(
  `Built ${stagingManifest.name}@${stagingManifest.version} in build/web-package`
);
