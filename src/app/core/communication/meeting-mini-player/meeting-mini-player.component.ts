import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { Router } from '@angular/router';
import { ToastService } from '@shared/ui/toast/toast.service';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { ActiveMeetingService } from '../active-meeting.service';
import { MeetingActiveSpeakerService } from '../meeting-active-speaker.service';
import { SrcObjectDirective } from '../src-object.directive';
import { MeetingParticipantDto } from '../meeting.model';
import { pickMiniPlayerTiles } from '../active-speaker.util';
import { MiniPlayerPoint, clampMiniPlayerPosition, parseStoredPosition } from './mini-player-position.util';

const POSITION_KEY = 'tv.meetingMiniPlayer.position';
const COLLAPSED_KEY = 'tv.meetingMiniPlayer.collapsed';
/** Huecos de la tira de miniaturas (el último lo ocupa "+N" si no caben). */
const MAX_THUMBS = 4;
/** Breakpoint `sm` de Tailwind: por debajo es barra inferior a lo ancho y no se arrastra. */
const DESKTOP_MIN_WIDTH = 640;

/**
 * Mini-player GLOBAL del meeting activo. Se monta en el shell (con @defer cuando hay meeting) y vive
 * en cualquier página: al salir de /meetings la sesión NO se corta, se minimiza abajo a la derecha.
 *
 * - Solo lee `ActiveMeetingService` (core no importa features) y `MeetingActiveSpeakerService`.
 * - Es el ÚNICO lugar que reproduce el audio remoto (`<audio>` siempre montados), también con la sala
 *   completa abierta; por eso los `<video>` de la sala van muted.
 * - El panel se oculta mientras la sala completa está montada (`roomViewAttached`).
 * - Tile principal = quien habla (→ fijado → primer remoto); mi cámara en PiP; resto en miniaturas "+N".
 * - Controles: micrófono, cámara, compartir pantalla, mano, volver a la sala, salir y terminar para
 *   todos (solo host). Arrastrable (posición en sessionStorage), colapsable a barra; en móvil, barra
 *   inferior a lo ancho.
 * - Si el meeting termina o me sacan estando minimizado: toast y desaparece (cierre completo sin recargar).
 *
 * Sin inputs/outputs: `<app-meeting-mini-player />`.
 */
@Component({
  selector: 'app-meeting-mini-player',
  imports: [NgClass, SrcObjectDirective, AvatarComponent, ConfirmDialogComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-mini-player.component.html',
})
export class MeetingMiniPlayerComponent {
  private readonly meeting = inject(ActiveMeetingService);
  private readonly speaker = inject(MeetingActiveSpeakerService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  @ViewChild('panel') private panelRef?: ElementRef<HTMLElement>;

  readonly phase = this.meeting.phase;
  readonly title = this.meeting.meetingTitle;
  readonly errorMessage = this.meeting.errorMessage;
  readonly localStream = this.meeting.localStream;
  readonly audioEnabled = this.meeting.audioEnabled;
  readonly videoEnabled = this.meeting.videoEnabled;
  readonly handRaised = this.meeting.handRaised;
  readonly screenSharing = this.meeting.screenSharing;
  readonly isHost = this.meeting.isHost;
  readonly canEndForAll = this.meeting.canEndForAll;
  readonly waitingParticipants = this.meeting.waitingParticipants;
  readonly recordingConsentFrom = this.meeting.recordingConsentFrom;
  readonly recordingElapsedLabel = this.meeting.recordingElapsedLabel;
  readonly isRecording = computed(() => this.meeting.recordingState() === 'Recording');
  readonly remoteAudio = this.speaker.remoteAudio;
  readonly speakingIds = this.speaker.speakingIds;

  /** getDisplayMedia solo existe en escritorio. */
  readonly canScreenShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  readonly visible = computed(() => this.phase() !== 'idle' && !this.meeting.roomViewAttached());
  readonly isJoined = computed(() => this.phase() === 'joined');
  readonly participantCount = computed(() => this.meeting.joinedParticipants().length);

  private readonly remoteById = computed(
    () => new Map(this.meeting.remoteParticipants().map(p => [p.userId, p] as const)),
  );

  readonly tiles = computed(() =>
    pickMiniPlayerTiles(
      this.meeting.remoteParticipants().map(p => p.userId),
      this.speaker.activeSpeakerId(),
      this.meeting.pinnedUserId(),
      MAX_THUMBS,
      this.speaker.lastVoiceAt(),
    ),
  );
  /** Participante del tile principal (null = estoy solo: el principal es mi cámara). */
  readonly mainParticipant = computed(() => {
    const id = this.tiles().main;
    return id ? (this.remoteById().get(id) ?? null) : null;
  });
  readonly thumbParticipants = computed(() =>
    this.tiles()
      .thumbs.map(id => this.remoteById().get(id))
      .filter((p): p is MeetingParticipantDto => !!p),
  );

  /** Quién comparte pantalla (aviso en el tile; la pantalla se ve al volver a la sala). */
  readonly sharingLabel = computed(() => {
    const remote = this.meeting.remoteParticipants().find(p => p.screenSharing);
    if (remote) {
      return `${remote.displayName} is sharing`;
    }
    return this.screenSharing() ? "You're sharing" : null;
  });

  readonly recordingRequesterName = computed(() => {
    const id = this.recordingConsentFrom();
    return this.meeting.participants().find(p => p.userId === id)?.displayName ?? 'A participant';
  });

  readonly statusLabel = computed(() => {
    switch (this.phase()) {
      case 'joining':
        return 'Joining…';
      case 'waiting':
        return 'Waiting for the host to let you in';
      case 'passcode':
        return 'Passcode required';
      case 'unsupported':
        return 'Video mode not supported';
      case 'ended':
        return this.errorMessage() || 'The meeting has ended';
      default:
        return `Live · ${this.participantCount()} ${this.participantCount() === 1 ? 'participant' : 'participants'}`;
    }
  });

  // ---------- Layout: colapsado, posición y arrastre ----------
  readonly collapsed = signal(readStorage(COLLAPSED_KEY) === '1');
  readonly isDesktop = signal(isDesktopViewport());
  readonly position = signal<MiniPlayerPoint | null>(parseStoredPosition(readStorage(POSITION_KEY)));
  readonly dragging = signal(false);
  private dragOffset: MiniPlayerPoint = { x: 0, y: 0 };

  // ---------- Terminar para todos ----------
  readonly endConfirmOpen = signal(false);
  readonly endBusy = signal(false);
  /** La salida/fin la inició este usuario desde aquí: no repetir el toast genérico de "terminó". */
  private endedByMe = false;

  constructor() {
    // Fin por evento (meeting terminado/cancelado, me sacaron, me denegaron) estando MINIMIZADO: no hay
    // sala que muestre "terminado", así que se avisa con toast y se cierra la sesión del todo (sin recargar).
    // Con la sala montada no se hace nada: la sala muestra su pantalla de fin con "Close".
    effect(() => {
      if (this.phase() !== 'ended' || this.meeting.roomViewAttached()) {
        return;
      }
      untracked(() => {
        if (!this.endedByMe) {
          this.toast.info(this.errorMessage() || 'The meeting has ended.');
        }
        this.endedByMe = false;
        this.endConfirmOpen.set(false);
        this.meeting.closeEnded();
      });
    });

    // Al reaparecer (volver de /meetings) la posición guardada puede no caber si la ventana cambió.
    effect(() => {
      if (this.visible()) {
        untracked(() => requestAnimationFrame(() => this.reclamp()));
      }
    });
  }

  // ---------- Controles ----------

  toggleAudio(): void {
    this.meeting.toggleAudio();
  }

  toggleVideo(): void {
    void this.meeting.toggleVideo();
  }

  toggleScreenShare(): void {
    void (this.screenSharing() ? this.meeting.stopScreenShare() : this.meeting.startScreenShare());
  }

  toggleHand(): void {
    this.meeting.toggleHandRaise();
  }

  /** Vuelve a la sala completa: /meetings la muestra sola si hay meeting activo (sin re-unirse). */
  expand(): void {
    void this.router.navigateByUrl('/meetings');
  }

  leave(): void {
    // leave() resetea a 'idle' (no pasa por 'ended'), así que no hay toast de "terminó" que evitar.
    void this.meeting.leave();
    this.toast.info('You left the meeting.');
  }

  async confirmEndForAll(): Promise<void> {
    if (this.endBusy()) {
      return;
    }
    this.endBusy.set(true);
    this.endedByMe = true;
    const ended = await this.meeting.endForAll();
    this.endBusy.set(false);
    this.endConfirmOpen.set(false);
    this.endedByMe = false;
    if (ended) {
      this.toast.success('Meeting ended for everyone.');
    }
  }

  respondRecording(accepted: boolean): void {
    this.meeting.respondRecordingConsent(accepted);
  }

  toggleCollapsed(): void {
    this.collapsed.update(value => !value);
    writeStorage(COLLAPSED_KEY, this.collapsed() ? '1' : '0');
    requestAnimationFrame(() => this.reclamp());
  }

  isSpeaking(userId: string): boolean {
    return this.speakingIds().has(userId);
  }

  streamFor(userId: string): MediaStream | null {
    return this.meeting.peers().get(userId)?.cameraStream ?? null;
  }

  // ---------- Arrastre (pointer events, solo escritorio) ----------

  onDragStart(event: PointerEvent): void {
    const panel = this.panelRef?.nativeElement;
    // Los botones del encabezado no inician arrastre; en móvil el panel es una barra fija.
    if (!panel || !this.isDesktop() || event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    this.dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.dragging.set(true);
    event.preventDefault();
  }

  onDragMove(event: PointerEvent): void {
    const panel = this.panelRef?.nativeElement;
    if (!this.dragging() || !panel) {
      return;
    }
    this.position.set(
      clampMiniPlayerPosition(
        { x: event.clientX - this.dragOffset.x, y: event.clientY - this.dragOffset.y },
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }

  onDragEnd(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }
    this.dragging.set(false);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    const pos = this.position();
    if (pos) {
      writeStorage(POSITION_KEY, JSON.stringify(pos));
    }
  }

  /** Doble clic en el encabezado: vuelve a la esquina inferior derecha. */
  resetPosition(): void {
    this.position.set(null);
    removeStorage(POSITION_KEY);
  }

  @HostListener('window:resize')
  onResize(): void {
    this.isDesktop.set(isDesktopViewport());
    this.reclamp();
  }

  private reclamp(): void {
    const panel = this.panelRef?.nativeElement;
    const pos = this.position();
    if (!panel || !pos || !this.isDesktop()) {
      return;
    }
    const next = clampMiniPlayerPosition(
      pos,
      { width: panel.offsetWidth, height: panel.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    if (next.x !== pos.x || next.y !== pos.y) {
      this.position.set(next);
    }
  }
}

function isDesktopViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth >= DESKTOP_MIN_WIDTH;
}

// sessionStorage puede no existir o lanzar (modo privado / políticas): se degrada a "sin memoria".
function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

function removeStorage(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* noop */
  }
}
