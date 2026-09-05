import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareImageVariants } from '../src/pipeline/images';
import type { ExportedAsset } from '../src/export';

async function main() {
  const root = path.resolve(import.meta.dirname, '../../../../');
  const fixtureDir = path.join(root, 'apps/site/fixtures/example');
  const content = JSON.parse(await readFile(path.join(fixtureDir, 'content.json'), 'utf8'));
  const cacheDir = path.join(tmpdir(), 'kompass-fixture-cache');
  await prepareImageVariants({ jobDir: fixtureDir, assets: content.assets as ExportedAsset[], cacheDir });
  console.log('Fixture images generated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
