import { Injectable, inject } from '@angular/core';
import { ToastService } from '@shared/ui/toast/toast.service';
import { prefersReducedMotion } from '@shared/utils/reduced-motion.util';
import { MediaPolicyService } from './media-policy.service';

/**
 * F4 (T-70) — Efectos de sonido de Communication (reuniones Y llamadas). Sustituye a
 * `MeetingSoundsService` con los mismos assets de `public/assets/sounds/meeting/`:
 *  - `join` / `rejoin`  → entrada-meeting.mp3 (rejoin usa el mismo asset: no hay uno propio)
 *  - `leave`            → salirse-meeting.mp3
 *  - `screen-share`     → compartir-pantalla-meeting.mp3
 *  - `notification`     → sonido-notificacion.mp3 (chat con el panel cerrado, mano, sala de espera…)
 *  - `chat-message`     → mensaje-recibido.mp3 (mensaje con el chat abierto / conversación activa)
 *  - llamadas: `ringing` → notification, `connected` → join, `ended` → leave (sin assets propios).
 *
 * Todo lo que antes eran constantes (`VOLUME`, `REPEAT_GAP_MS`) sale de la política de media:
 * `sounds.policy` (`all|hostOnly|off`; `hostOnly` solo aplica a join/leave/rejoin y exige `isHost`),
 * `volumePct`, `repeatGapMs` y `muted` (preferencia del usuario). Con `prefers-reduced-motion` no
 * suena nada pero, si el llamante dio `fallbackText`, se muestra un toast equivalente.
 * Sin política cargada no suena (nunca se inventan valores); un efecto jamás rompe la sesión.
 */
export type CommunicationSound = 'join' | 'rejoin' | 'leave' | 'screen-share' | 'notification' | 'chat-message' | 'ringing' | 'connected' | 'ended';

export interface PlaySoundOptions {
  /** Para `hostOnly`: ¿soy host/cohost? (las llamadas pasan true). */
  isHost?: boolean;
  /** Equivalente visual cuando el sistema pide menos movimiento/sonido. */
  fallbackText?: string;
}

type Asset = 'join' | 'leave' | 'screen-share' | 'notification' | 'chat-message';

const ASSET_OF: Record<CommunicationSound, Asset> = {
  join: 'join',
  rejoin: 'join',
  leave: 'leave',
  'screen-share': 'screen-share',
  notification: 'notification',
  'chat-message': 'chat-message',
  ringing: 'notification',
  connected: 'join',
  ended: 'leave',
};

const SOUND_FILES: Record<Asset, string> = {
  join: 'assets/sounds/meeting/entrada-meeting.mp3',
  leave: 'assets/sounds/meeting/salirse-meeting.mp3',
  'screen-share': 'assets/sounds/meeting/compartir-pantalla-meeting.mp3',
  notification: 'assets/sounds/meeting/sonido-notificacion.mp3',
  'chat-message': 'assets/sounds/meeting/mensaje-recibido.mp3',
};

/** Sonidos de presencia: los únicos que distingue la política `hostOnly`. */
const PRESENCE_SOUNDS: ReadonlySet<CommunicationSound> = new Set(['join', 'rejoin', 'leave']);

@Injectable({ providedIn: 'root' })
export class SoundsService {
  private readonly mediaPolicy = inject(MediaPolicyService);
  private readonly toast = inject(ToastService);
  private readonly players = new Map<Asset, HTMLAudioElement>();
  private readonly lastPlayedAt = new Map<CommunicationSound, number>();

  /** ¿Sonaría ahora `sound`? (política, mute del usuario y gap de repetición aparte). */
  isAllowed(sound: CommunicationSound, opts: PlaySoundOptions = {}): boolean {
    const sounds = this.mediaPolicy.policy()?.sounds;
    if (!sounds || sounds.muted || sounds.policy === 'off') {
      return false;
    }
    if (sounds.policy === 'hostOnly' && PRESENCE_SOUNDS.has(sound) && !opts.isHost) {
      return false;
    }
    return true;
  }

  play(sound: CommunicationSound, opts: PlaySoundOptions = {}): void {
    const sounds = this.mediaPolicy.policy()?.sounds;
    if (!sounds) {
      void this.mediaPolicy.ensureLoaded().catch(() => undefined); // la próxima vez ya estará
      return;
    }
    if (!this.isAllowed(sound, opts)) {
      return;
    }
    const now = Date.now();
    if (now - (this.lastPlayedAt.get(sound) ?? 0) < sounds.repeatGapMs) {
      return;
    }
    this.lastPlayedAt.set(sound, now);
    if (prefersReducedMotion()) {
      if (opts.fallbackText) {
        this.toast.info(opts.fallbackText);
      }
      return;
    }
    if (typeof Audio === 'undefined') {
      return; // SSR / tests sin media
    }
    const asset = ASSET_OF[sound];
    let player = this.players.get(asset);
    if (!player) {
      player = new Audio(SOUND_FILES[asset]);
      player.preload = 'auto';
      this.players.set(asset, player);
    }
    try {
      player.volume = Math.min(1, Math.max(0, sounds.volumePct / 100));
      player.currentTime = 0;
      void player.play()?.catch(() => undefined);
    } catch {
      /* autoplay bloqueado o media no soportada: sin sonido */
    }
  }
}
