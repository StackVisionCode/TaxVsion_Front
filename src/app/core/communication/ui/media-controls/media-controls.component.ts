import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, input, output } from '@angular/core';
import { NgClass } from '@angular/common';
import { TooltipDirective } from '@shared/ui/tooltip/tooltip.directive';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import type { MuteReason } from '../../media/local-media-session';

export type MediaControlsSize = 'sm' | 'md' | 'lg';

/** Petición de compartir pantalla (D-41: con o sin audio de la pantalla). */
export interface ScreenShareRequest {
  withAudio: boolean;
}

/** El audio de pantalla (`getDisplayMedia({audio})`) solo lo exponen los navegadores Chromium. */
export function supportsScreenAudio(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && /chrome|chromium|edg\//i.test(userAgent);
}

/**
 * F4 — Barra de controles de media común a la sala, el overlay de llamada y el mini-player.
 * Sin lógica de media: recibe estado y emite acciones.
 *
 *   <app-media-controls [audioEnabled]="audioEnabled()" [videoEnabled]="videoEnabled()" [muteReason]="muteReason()"
 *     [videoPausedByNetwork]="videoPausedByNetwork()" [screenSharing]="screenSharing()" [screenAudioAllowed]="true"
 *     [showHand]="true" [handRaised]="handRaised()" [showChat]="true" [chatUnread]="chatUnread()" leaveLabel="Leave"
 *     (toggleAudio)="…" (toggleVideo)="…" (shareScreen)="start($event.withAudio)" (stopScreenShare)="stop()"
 *     (toggleHand)="…" (toggleChat)="…" (openDevices)="devicesOpen.set(true)" (leave)="leave()">
 *     …botones extra (grabar, "Turn on video") se proyectan antes del botón de salir…
 *   </app-media-controls>
 *
 * Estados especiales (tooltip explicativo): mute por `muteReason` 'echo' / 'host' (ámbar), "No microphone"
 * (`hasMicrophone=false`, deshabilitado), "Waiting for permission…" (`waitingForPermission`), cámara
 * pausada por red ("Video paused to protect audio", ámbar). Compartir: si `screenAudioAllowed` y el
 * navegador lo soporta, el botón abre un menú "Share screen" / "Share screen with audio".
 * `variant`: 'pill' (píldora oscura flotante) | 'bare' (solo la fila). `size`: sm (mini-player) · md (sala) · lg (overlay).
 * F5: `raisedHands` pone un contador sobre el botón de mano; `showMore` pliega los secundarios bajo "More" en `< sm`
 * (los ítems del menú los proyecta el padre con el atributo `moreItem`).
 */
@Component({
  selector: 'app-media-controls',
  imports: [NgClass, TooltipDirective, DropdownMenuComponent, MenuItemDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './media-controls.component.html',
})
export class MediaControlsComponent {
  // ---------- Estado ----------
  readonly audioEnabled = input(true);
  readonly videoEnabled = input(false);
  readonly screenSharing = input(false);
  readonly handRaised = input(false);
  /** F5 — manos levantadas en la sala (badge sobre el botón de mano; 0 = sin badge). */
  readonly raisedHands = input(0);
  readonly chatOpen = input(false);
  readonly chatUnread = input(0);
  readonly muteReason = input<MuteReason | null>(null);
  readonly videoPausedByNetwork = input(false);
  readonly hasMicrophone = input(true);
  readonly waitingForPermission = input(false);

  // ---------- Qué mostrar ----------
  readonly showCamera = input(true);
  readonly showScreenShare = input(true);
  /** Política `screenShare.audioAllowed`: habilita la opción "Share screen with audio". */
  readonly screenAudioAllowed = input(false);
  readonly showHand = input(false);
  readonly showChat = input(false);
  readonly showDevices = input(true);
  readonly showLeave = input(true);
  /**
   * F5 (T-57) — en `< sm` los secundarios (compartir, mano, dispositivos y lo proyectado) se pliegan bajo
   * un botón "More"; el padre proyecta sus equivalentes como `<button appMenuItem moreItem …>`.
   */
  readonly showMore = input(false);
  /** Texto del botón de salir; null = solo icono. */
  readonly leaveLabel = input<string | null>(null);
  readonly leaveTitle = input('Leave');
  readonly size = input<MediaControlsSize>('md');
  readonly variant = input<'pill' | 'bare'>('pill');

  // ---------- Acciones ----------
  readonly toggleAudio = output<void>();
  readonly toggleVideo = output<void>();
  readonly shareScreen = output<ScreenShareRequest>();
  readonly stopScreenShare = output<void>();
  readonly toggleHand = output<void>();
  readonly toggleChat = output<void>();
  readonly openDevices = output<void>();
  readonly leave = output<void>();

  /** getDisplayMedia solo existe en escritorio: sin él no se ofrece compartir. */
  readonly canShare = computed(() => this.showScreenShare() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia);
  readonly offersScreenAudio = computed(() => this.screenAudioAllowed() && supportsScreenAudio());

  readonly micDisabled = computed(() => !this.hasMicrophone() || this.waitingForPermission());

  readonly micTooltip = computed(() => {
    if (this.waitingForPermission()) {
      return 'Waiting for permission…';
    }
    if (!this.hasMicrophone()) {
      return 'No microphone';
    }
    if (this.audioEnabled()) {
      return 'Mute microphone';
    }
    switch (this.muteReason()) {
      case 'echo':
        return 'Muted: we detected echo from your side. Use headphones or lower your speaker volume, then unmute.';
      case 'host':
        return 'Muted by the host. Unmute when you want to speak.';
      default:
        return 'Unmute microphone';
    }
  });

  readonly cameraTooltip = computed(() => {
    if (this.videoPausedByNetwork()) {
      return 'Video paused to protect audio';
    }
    return this.videoEnabled() ? 'Turn camera off' : 'Turn camera on';
  });

  /** Mute "ajeno" (eco / host) va en ámbar para distinguirlo del mute propio (rojo). */
  readonly micClass = computed(() => {
    if (this.micDisabled()) {
      return 'bg-white/10 text-white/50';
    }
    if (this.audioEnabled()) {
      return 'bg-white/10 text-white hover:bg-white/20';
    }
    const reason = this.muteReason();
    return reason === 'echo' || reason === 'host' ? 'bg-amber-400 text-amber-950 hover:bg-amber-300' : 'bg-red-500 text-white hover:bg-red-600';
  });

  readonly cameraClass = computed(() => {
    if (this.videoPausedByNetwork()) {
      return 'bg-amber-400 text-amber-950 hover:bg-amber-300';
    }
    return this.videoEnabled() ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-red-500 text-white hover:bg-red-600';
  });

  /** Tamaño de cada botón redondo. */
  readonly buttonClass = computed(() => {
    switch (this.size()) {
      case 'sm':
        return 'h-10 w-10 text-lg';
      case 'lg':
        return 'h-12 w-12 text-xl';
      default:
        return 'h-11 w-11 text-xl';
    }
  });

  readonly wrapClass = computed(() =>
    this.variant() === 'pill'
      ? 'flex max-w-full items-center gap-2 overflow-x-auto rounded-full bg-black/60 p-2 shadow-lg backdrop-blur-md'
      : 'flex max-w-full items-center justify-center gap-2',
  );

  protected onShareClick(): void {
    if (this.screenSharing()) {
      this.stopScreenShare.emit();
    } else {
      this.shareScreen.emit({ withAudio: false });
    }
  }

  protected share(withAudio: boolean): void {
    this.shareScreen.emit({ withAudio });
  }
}
