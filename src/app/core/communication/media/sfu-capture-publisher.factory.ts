import { InjectionToken } from '@angular/core';
// Solo tipos: el publicador (y mediasoup-client) se descargan al crear el primero.
import type { SfuCapturePublisher, SfuCapturePublisherOptions } from './sfu-capture-publisher';

/** Lo que usa el orquestador del publicador. */
export type SfuCapturePublisherHandle = Pick<SfuCapturePublisher, 'start' | 'setTrack' | 'close'>;

/**
 * F7 (D-56) — crea el publicador SFU de solo envío con carga perezosa (R2). Token para que los tests
 * lo reemplacen por TestBed (el runner de Angular no admite `vi.mock` de imports relativos).
 */
export const SFU_CAPTURE_PUBLISHER_FACTORY = new InjectionToken<(options: SfuCapturePublisherOptions) => Promise<SfuCapturePublisherHandle>>(
  'SFU_CAPTURE_PUBLISHER_FACTORY',
  {
    providedIn: 'root',
    factory: () => async options => {
      const { SfuCapturePublisher } = await import('./sfu-capture-publisher');
      return new SfuCapturePublisher(options);
    },
  },
);
