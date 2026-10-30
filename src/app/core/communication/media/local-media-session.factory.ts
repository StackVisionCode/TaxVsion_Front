import { Injectable, inject } from '@angular/core';
import { MediaDevicesService } from './media-devices.service';
import { MediaPolicyDto } from './media-policy.model';
import { LocalMediaSession, LocalMediaSessionHandlers } from './local-media-session';

/**
 * F4 — Crea la `LocalMediaSession` de una llamada o reunión con los dispositivos y la política
 * vigentes. Los orquestadores no instancian la sesión a mano (así los specs la reemplazan por un doble).
 */
@Injectable({ providedIn: 'root' })
export class LocalMediaSessionFactory {
  private readonly devices = inject(MediaDevicesService);

  create(policy: MediaPolicyDto, handlers: LocalMediaSessionHandlers): LocalMediaSession {
    return new LocalMediaSession(policy, this.devices, handlers);
  }
}
