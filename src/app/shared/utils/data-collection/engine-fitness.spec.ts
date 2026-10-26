import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('data collection engine fitness', () => {
  it('has no Angular, RxJS, browser storage or unsafe HTML dependency', () => {
    const root = join(process.cwd(), 'src', 'app', 'shared', 'utils', 'data-collection');
    const source = sourceFiles(root)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/from\s+['"]@angular\//);
    expect(source).not.toMatch(/from\s+['"]rxjs(?:\/|['"])/);
    expect(source).not.toContain('innerHTML');
    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB|sendBeacon)\b/);
  });
});

function sourceFiles(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    if (statSync(child).isDirectory()) return name === 'fixtures' ? [] : sourceFiles(child);
    return child.endsWith('.ts') && !child.endsWith('.spec.ts') ? [child] : [];
  });
}
