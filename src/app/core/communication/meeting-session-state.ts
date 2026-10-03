import { Injectable, signal } from '@angular/core';

export type ActiveMeetingPhase = 'idle' | 'joining' | 'waiting' | 'passcode' | 'joined' | 'unsupported' | 'ended';

/**
 * Estado MÍNIMO de la sesión de meeting (solo la fase), separado de `ActiveMeetingService` para que el
 * shell pueda decidir cuándo montar el mini-player (`@defer (when phase() !== 'idle')`) sin meter en el
 * bundle inicial todo el servicio de meetings (mesh/SFU/socket, ~12 kB) — regla R3/R5.
 *
 * El dueño de la fase es `ActiveMeetingService` (expone este mismo signal como `phase`); nadie más la
 * escribe. Uso en el shell: `inject(MeetingSessionState).phase()`.
 */
@Injectable({ providedIn: 'root' })
export class MeetingSessionState {
  readonly phase = signal<ActiveMeetingPhase>('idle');
}
