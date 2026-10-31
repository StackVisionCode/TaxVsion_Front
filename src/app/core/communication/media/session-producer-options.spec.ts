import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SESSION_PRODUCER_OPTIONS } from './session-producer-options';

/** Todos los .ts (sin specs) bajo un directorio. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('SESSION_PRODUCER_OPTIONS', () => {
  it('la sesión es dueña de la pista: no nace pausado por una pista en mute, no la toca al pausar ni la detiene', () => {
    expect(SESSION_PRODUCER_OPTIONS).toEqual({ stopTracks: false, disableTrackOnPause: false, zeroRtpOnPause: true });
  });

  it('todo producer de core/communication publica con estas opciones', () => {
    const dir = join(process.cwd(), 'src', 'app', 'core', 'communication');
    const offenders = sources(dir).filter(file => {
      const source = readFileSync(file, 'utf8');
      return /\.produce\(\{/.test(source) && !source.includes('...SESSION_PRODUCER_OPTIONS');
    });
    expect(offenders).toEqual([]);
  });
});
