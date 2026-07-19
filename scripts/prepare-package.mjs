import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, '..');
const moduleDirectory = path.join(repositoryDirectory, 'lib/module');

await mkdir(moduleDirectory, { recursive: true });
await writeFile(
  path.join(moduleDirectory, 'package.json'),
  `${JSON.stringify({ type: 'module' }, null, 2)}\n`
);

for (const filename of await readdir(moduleDirectory)) {
  if (!filename.endsWith('.js')) {
    continue;
  }
  const filePath = path.join(moduleDirectory, filename);
  const source = await readFile(filePath, 'utf8');
  const nodeCompatibleSource = source.replace(
    /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g,
    (match, prefix, specifier, suffix) =>
      path.extname(specifier) ? match : `${prefix}${specifier}.js${suffix}`
  );
  await writeFile(filePath, nodeCompatibleSource);
}
