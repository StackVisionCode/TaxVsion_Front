import { Component, ElementRef, effect, inject, viewChildren } from '@angular/core';
import { SrcObjectDirective } from '../../src-object.directive';
import { MeetingActiveSpeakerService } from '../../meeting-active-speaker.service';
import { MediaDevicesService } from '../../media/media-devices.service';

/**
 * F6 — Salida de audio remoto de la reunión activa (micrófonos y pantallas compartidas), un `<audio>`
 * por pista, enrutado al altavoz elegido en Devices (`setSinkId`). Lo lee de `MeetingActiveSpeakerService`.
 *
 *   <app-meeting-remote-audio />
 *
 * Debe estar montado UNA sola vez mientras hay meeting: en el shell lo monta el mini-player (también
 * con la sala completa abierta, cuyos `<video>` van muted); la página pública de invitado (`/meet/:token`,
 * sin shell ni mini-player) lo monta ella. Nunca dos a la vez: el audio sonaría doble.
 */
@Component({
  selector: 'app-meeting-remote-audio',
  imports: [SrcObjectDirective],
  template: `
    @for (source of remoteAudio(); track source.trackId) {
      <audio #remoteAudio [srcObject]="source.stream" autoplay class="hidden"></audio>
    }
    <!-- F4 (D-41): audio de cada pantalla compartida, en su propio <audio> con volumen por participante -->
    @for (source of remoteScreenAudio(); track source.trackId) {
      <audio #remoteAudio [srcObject]="source.stream" autoplay class="hidden" data-role="screen-audio" [attr.data-user]="source.userId"
        [volume]="screenAudioVolume(source.userId)"></audio>
    }
  `,
})
export class MeetingRemoteAudioComponent {
  private readonly speaker = inject(MeetingActiveSpeakerService);
  private readonly devices = inject(MediaDevicesService);
  private readonly audioElements = viewChildren<ElementRef<HTMLAudioElement>>('remoteAudio');

  readonly remoteAudio = this.speaker.remoteAudio;
  readonly remoteScreenAudio = this.speaker.remoteScreenAudio;

  constructor() {
    // Altavoz elegido en Devices → `setSinkId` en cada <audio> remoto (donde el navegador lo soporte).
    effect(() => {
      const sinkId = this.devices.preferred().audioOutputId;
      for (const el of this.audioElements()) {
        void this.devices.applySinkId(el.nativeElement, sinkId);
      }
    });
  }

  screenAudioVolume(userId: string): number {
    return this.speaker.screenAudioVolume(userId);
  }
}
