import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from './fixtures/v1/manifest.json';
import { ENGINE_VERSION, FIXTURE_SET_VERSION } from './engine-version';

describe('data collection engine version', () => {
  it('matches the canonical fixture set', () => {
    expect(FIXTURE_SET_VERSION).toBe(manifest.fixtureSetVersion);
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+\+sha256\.[a-f0-9]{12}$/);
  });

  it('matches the hash of the current engine sources', () => {
    // Mismo cálculo que scripts/sync-data-collection-engine.mjs; si falla, correr --write-version.
    const root = join(process.cwd(), 'src', 'app', 'shared', 'utils', 'data-collection');
    const hash = createHash('sha256');
    for (const relative of canonicalFiles(root)) {
      hash.update(relative);
      hash.update('\0');
      hash.update(readFileSync(join(root, relative), 'utf8').replaceAll('\r\n', '\n'));
      hash.update('\0');
    }
    expect(ENGINE_VERSION.split('sha256.')[1]).toBe(hash.digest('hex').slice(0, 12));
  });
});

function canonicalFiles(root: string, current = ''): string[] {
  const files = readdirSync(join(root, current)).flatMap((name) => {
    const relative = current ? `${current}/${name}` : name;
    if (statSync(join(root, relative)).isDirectory()) return canonicalFiles(root, relative);
    return relative.endsWith('.spec.ts') || relative === 'engine-version.ts' ? [] : [relative];
  });
  return files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
