import { Injectable } from '@angular/core';

/**
 * Efectos de sonido del meeting. Cada archivo vive en `public/assets/sounds/meeting/` y se nombra por
 * lo que hace:
 *  - `join`         → entrada-meeting.mp3            (entro yo, o entra otro participante)
 *  - `leave`        → salirse-meeting.mp3            (salgo yo / termina el meeting, o sale otro)
 *  - `screen-share` → compartir-pantalla-meeting.mp3 (empiezo a compartir, o empieza otro)
 *  - `notification` → sonido-notificacion.mp3        (chat nuevo, mano levantada, sala de espera,
 *                                                     pedido de grabación)
 *
 * Los `<audio>` se crean la primera vez que suenan (no se descarga nada al entrar a la app). Si el
 * navegador bloquea el autoplay o el archivo falla, se ignora: un efecto nunca rompe el meeting.
 * Un mismo sonido no se repite dentro de `REPEAT_GAP_MS` (p. ej. varios mensajes en ráfaga).
 */
export type MeetingSound = 'join' | 'leave' | 'screen-share' | 'notification';

const SOUND_FILES: Record<MeetingSound, string> = {
  join: 'assets/sounds/meeting/entrada-meeting.mp3',
  leave: 'assets/sounds/meeting/salirse-meeting.mp3',
  'screen-share': 'assets/sounds/meeting/compartir-pantalla-meeting.mp3',
  notification: 'assets/sounds/meeting/sonido-notificacion.mp3',
};

const VOLUME = 0.6;
const REPEAT_GAP_MS = 400;

@Injectable({ providedIn: 'root' })
export class MeetingSoundsService {
  private readonly players = new Map<MeetingSound, HTMLAudioElement>();
  private readonly lastPlayedAt = new Map<MeetingSound, number>();

  play(sound: MeetingSound): void {
    if (typeof Audio === 'undefined') {
      return; // SSR / tests sin media
    }
    const now = Date.now();
    if (now - (this.lastPlayedAt.get(sound) ?? 0) < REPEAT_GAP_MS) {
      return;
    }
    this.lastPlayedAt.set(sound, now);

    let player = this.players.get(sound);
    if (!player) {
      player = new Audio(SOUND_FILES[sound]);
      player.preload = 'auto';
      player.volume = VOLUME;
      this.players.set(sound, player);
    }
    try {
      player.currentTime = 0;
      void player.play()?.catch(() => undefined);
    } catch {
      /* autoplay bloqueado o media no soportada: sin sonido */
    }
  }
}
