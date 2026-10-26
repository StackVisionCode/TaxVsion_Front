import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

describe('data collection renderer fitness', () => {
  it('no usa innerHTML ni importa features', () => {
    const root = join(process.cwd(), 'src/app/shared/ui/data-collection');
    const files = walk(root).filter(
      (file) => /\.(ts|html)$/.test(file) && !file.endsWith('.spec.ts'),
    );
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toContain('innerHTML');
    expect(source).not.toContain('@angular/forms');
    expect(source).not.toContain('BehaviorSubject');
    expect(source).not.toMatch(/from ['"][^'"]*features\//);
  });
});

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
