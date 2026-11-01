import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * F4 — regla de arquitectura: los orquestadores (llamada 1:1 y reunión) NO tocan media ni
 * RTCPeerConnection: eso vive en `core/communication/media/`. Si alguien vuelve a meter una captura,
 * un `addTrack`, un `getStats` o un número de resolución/bitrate en ellos, este test lo frena.
 */
const ORCHESTRATORS = ['active-call.service.ts', 'active-meeting.service.ts'];
const FORBIDDEN: readonly { label: string; pattern: RegExp }[] = [
  { label: 'getUserMedia', pattern: /getUserMedia/ },
  { label: 'getDisplayMedia', pattern: /getDisplayMedia/ },
  { label: 'addTrack(', pattern: /addTrack\(/ },
  { label: 'addTransceiver(', pattern: /addTransceiver\(/ },
  { label: 'getStats(', pattern: /getStats\(/ },
  { label: 'new RTCPeerConnection', pattern: /new RTCPeerConnection/ },
  { label: 'new Audio(', pattern: /new Audio\(/ },
  { label: 'literal 1280', pattern: /\b1280\b/ },
  { label: 'literal 720', pattern: /\b720\b/ },
  { label: 'literal 1000', pattern: /\b1[_]?000\b/ },
];

/** Números que antes vivían como constantes del cliente y ahora vienen de la política (F4 parte 2). */
const POLICY_OWNED = ['meeting-sfu.service.ts', 'media/client-recording-session.ts'];
const FORBIDDEN_NUMBERS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'CAMERA_BITS_PER_PIXEL', pattern: /BITS_PER_PIXEL/ },
  { label: 'RECORDING_AUDIO_BITS_PER_SECOND', pattern: /RECORDING_AUDIO_BITS_PER_SECOND/ },
  { label: 'literal 0.045', pattern: /\b0\.045\b/ },
  { label: 'literal 56000', pattern: /\b56[_]?000\b/ },
  { label: 'literal 1250', pattern: /\b1250\b/ },
];

describe('media architecture — los orquestadores no contienen media', () => {
  const dir = join(process.cwd(), 'src', 'app', 'core', 'communication');

  for (const file of ORCHESTRATORS) {
    it(`${file} delega la media en core/communication/media`, () => {
      const source = readFileSync(join(dir, file), 'utf8');
      const offenders = FORBIDDEN.filter(f => f.pattern.test(source)).map(f => f.label);
      expect(offenders, `${file} contiene: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  for (const file of POLICY_OWNED) {
    it(`${file} toma los bitrates de la política, no de constantes propias`, () => {
      const source = readFileSync(join(dir, file), 'utf8');
      const offenders = FORBIDDEN_NUMBERS.filter(f => f.pattern.test(source)).map(f => f.label);
      expect(offenders, `${file} contiene: ${offenders.join(', ')}`).toEqual([]);
    });
  }
});

describe('media architecture — mediasoup-client solo por su puente ESM', () => {
  // En producción el optimizador de chunks deja sin `export` el chunk de un `import()` directo a
  // mediasoup-client (CommonJS) y `Device` llega undefined. Solo `mediasoup-device.ts` lo importa.
  it('nadie hace import() de mediasoup-client fuera de media/mediasoup-device.ts', () => {
    const root = join(process.cwd(), 'src', 'app');
    const offenders = (readdirSync(root, { recursive: true }) as string[])
      .filter(file => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .filter(file => /import\(\s*['"]mediasoup-client['"]\s*\)/.test(readFileSync(join(root, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('el puente mediasoup-device.ts se carga siempre con import()', () => {
    const root = join(process.cwd(), 'src', 'app');
    const staticImporters = (readdirSync(root, { recursive: true }) as string[])
      .filter(file => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .filter(file => /from\s+['"][./]*(media\/)?mediasoup-device['"]/.test(readFileSync(join(root, file), 'utf8')));
    expect(staticImporters).toEqual([]);
  });
});
