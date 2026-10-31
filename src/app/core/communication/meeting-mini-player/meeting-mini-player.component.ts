import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { TooltipDirective } from '@shared/ui/tooltip/tooltip.directive';
import { ActiveMeetingService, MeetingHostTileAction } from '../active-meeting.service';
import { ActiveCallService } from '../active-call.service';
import { MeetingActiveSpeakerService, SELF_LEVEL_KEY } from '../meeting-active-speaker.service';
import { MeetingPipService } from '../meeting-pip.service';
import { SrcObjectDirective } from '../src-object.directive';
import { MeetingParticipantDto } from '../meeting.model';
import { pickMiniPlayerTiles } from '../active-speaker.util';
import { durationWarningLabel } from '../meeting-clock.util';
import type { MeetingReaction } from '../meeting-reactions.util';
import { MiniPlayerPoint, MiniPlayerSize, avoidReservedCorner, clampMiniPlayerPosition, parseStoredPosition } from './mini-player-position.util';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { MediaControlsComponent, ScreenShareRequest } from '../ui/media-controls/media-controls.component';
import { QualityBadgeComponent } from '../ui/quality-badge/quality-badge.component';
import { DevicePanelComponent } from '../ui/device-panel/device-panel.component';
import { MeetingParticipantTileComponent, ParticipantTileHostAction } from '../ui/participant-tile/participant-tile.component';
import { ReactionPickerComponent } from '../ui/reaction-picker/reaction-picker.component';
import { RecordingBadgeComponent } from '../ui/recording-badge/recording-badge.component';
import { MeetingRemoteAudioComponent } from '../ui/remote-audio/meeting-remote-audio.component';
import { MeetingSessionState } from '../meeting-session-state';
import { MediaDevicesService } from '../media/media-devices.service';
import { MediaPolicyService } from '../media/media-policy.service';
import { PermissionService } from '@core/auth/permission.service';

const POSITION_KEY = 'tv.meetingMiniPlayer.position';
const COLLAPSED_KEY = 'tv.meetingMiniPlayer.collapsed';
/** Huecos de la tira de miniaturas (el último lo ocupa "+N" si no caben). */
const MAX_THUMBS = 4;
/** Breakpoint `sm` de Tailwind: por debajo es barra inferior a lo ancho y no se arrastra. */
const DESKTOP_MIN_WIDTH = 640;
/** T-58: hueco que ocupa el overlay de llamada abajo a la derecha (sm:w-96 + alto del stage de video). */
const CALL_OVERLAY_SIZE: MiniPlayerSize = { width: 384, height: 340 };
/** Tamaño del panel antes de medirlo (sm:w-[22rem]). */
const DEFAULT_PANEL_SIZE: MiniPlayerSize = { width: 352, height: 320 };
/** actorTypes de staff: ven las cifras del badge de calidad (D-39). */
const STAFF_ACTORS = ['TenantEmployee', 'TenantAdmin', 'PlatformAdmin'] as const;
/** Mensajes que muestra el chat compacto. */
const COMPACT_CHAT_MESSAGES = 30;
/** Filas de la sala de espera con "Admit" directo; el resto se admite desde la sala. */
const WAITING_ROWS = 3;

/**
 * Mini-player GLOBAL del meeting activo. Se monta en el shell (con @defer cuando hay meeting) y vive
 * en cualquier página: al salir de /meetings la sesión NO se corta, se minimiza abajo a la derecha.
 *
 * - Solo lee `ActiveMeetingService` (core no importa features) y `MeetingActiveSpeakerService`.
 * - Es el ÚNICO lugar del shell que reproduce el audio remoto (`app-meeting-remote-audio`, siempre
 *   montado), también con la sala completa abierta; por eso los `<video>` de la sala van muted. Vive FUERA
 *   del panel: al salir a PiP (Document PiP mueve el panel) se queda en la ventana principal.
 * - F6: "Invite" (host/cohost) pide abrir la sala con el panel de invitaciones (`MeetingSessionState`).
 * - El panel se oculta mientras la sala completa está montada (`roomViewAttached`), salvo que se haya
 *   pedido "Pop out" (`MeetingPipService.requested`).
 * - F5 (T-54): si alguien comparte, su pantalla es el principal (hablante en PiP interno) con "View
 *   camera / screen"; principal y miniaturas son el tile único; chat compacto con no leídos; "N waiting"
 *   con Admit directo (host); React (picker diferido); "Pop out" (PiP progresivo, D-43).
 * - Controles: micrófono, cámara, compartir pantalla, mano, volver a la sala, salir y terminar para
 *   todos (host/cohost). Arrastrable (posición en sessionStorage), colapsable a barra; en móvil, barra
 *   inferior a lo ancho; ancho `min(22rem, 100vw - 1rem)`.
 * - Si el meeting termina o me sacan estando minimizado: toast y desaparece (cierre completo sin recargar).
 *
 * Sin inputs/outputs: `<app-meeting-mini-player />`.
 */
@Component({
  selector: 'app-meeting-mini-player',
  imports: [
    InfinityLoaderComponent,
    NgClass,
    FormsModule,
    SrcObjectDirective,
    ConfirmDialogComponent,
    TooltipDirective,
    MediaControlsComponent,
    QualityBadgeComponent,
    DevicePanelComponent,
    MeetingParticipantTileComponent,
    ReactionPickerComponent,
    MeetingRemoteAudioComponent,
    RecordingBadgeComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-mini-player.component.html',
})
export class MeetingMiniPlayerComponent {
  private readonly meeting = inject(ActiveMeetingService);
  private readonly session = inject(MeetingSessionState);
  private readonly speaker = inject(MeetingActiveSpeakerService);
  private readonly activeCall = inject(ActiveCallService);
  private readonly devices = inject(MediaDevicesService);
  private readonly mediaPolicy = inject(MediaPolicyService);
  private readonly perms = inject(PermissionService);
  private readonly pip = inject(MeetingPipService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  readonly phase = this.meeting.phase;
  readonly title = this.meeting.meetingTitle;
  readonly errorMessage = this.meeting.errorMessage;
  readonly localStream = this.meeting.localStream;
  readonly audioEnabled = this.meeting.audioEnabled;
  readonly videoEnabled = this.meeting.videoEnabled;
  readonly handRaised = this.meeting.handRaised;
  readonly screenSharing = this.meeting.screenSharing;
  readonly isHost = this.meeting.isHost;
  readonly isPrimaryHost = this.meeting.isPrimaryHost;
  readonly canEndForAll = this.meeting.canEndForAll;
  readonly waitingParticipants = this.meeting.waitingParticipants;
  readonly recordingConsentFrom = this.meeting.recordingConsentFrom;
  readonly recordingElapsedLabel = this.meeting.recordingElapsedLabel;
  /** F7 — restante hasta el tope de la grabación y estado (REC / "Processing recording…"). */
  readonly recordingRemainingLabel = this.meeting.recordingRemainingLabel;
  readonly recordingState = this.meeting.recordingState;
  readonly isRecording = computed(() => this.meeting.recordingState() === 'Recording');
  /** F4 (D-41): audio de las pantallas compartidas, con volumen por participante (el control de volumen). */
  readonly remoteScreenAudio = this.speaker.remoteScreenAudio;
  readonly speakingIds = this.speaker.speakingIds;
  readonly selfSpeaking = this.speaker.selfSpeaking;
  readonly muteReason = this.meeting.muteReason;
  readonly videoPausedByNetwork = this.meeting.videoPausedByNetwork;
  readonly connectionQuality = this.meeting.connectionQuality;
  readonly connectionMetrics = this.meeting.connectionMetrics;
  readonly waitingForPermission = this.devices.waitingForPermission;
  readonly hasMicrophone = computed(() => !this.meeting.microphoneError());
  readonly showMetrics = computed(() => this.perms.isActor(...STAFF_ACTORS));
  readonly screenAudioAllowed = computed(() => this.mediaPolicy.policy()?.screenShare.audioAllowed ?? false);
  /** Punto de alerta: algún remoto con conexión Poor / Disconnected. */
  readonly remotePoor = computed(() =>
    this.meeting.remoteParticipants().some(p => p.connectionQuality === 'Poor' || p.connectionQuality === 'Disconnected'),
  );
  readonly devicesOpen = signal(false);
  /** T-58: el overlay de llamada está en pantalla (entrante/saliente/en curso). */
  readonly callVisible = computed(() => this.activeCall.phase() !== 'idle');
  readonly self = this.meeting.selfParticipant;
  readonly nowMs = this.meeting.nowMs;
  readonly myUserId = this.meeting.myUserId;

  /** Visible minimizado; también con la sala abierta si se pidió "Pop out" (el panel se mueve a la ventana PiP). */
  readonly visible = computed(() => this.phase() !== 'idle' && (!this.meeting.roomViewAttached() || this.pip.requested()));
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

  // ---------- F5 (T-54): pantalla compartida como principal ----------
  /** Pantalla activa: la de un remoto (la primera que comparte) o la mía. */
  readonly activeShare = computed<{ userId: string; displayName: string; isMine: boolean; stream: MediaStream | null } | null>(() => {
    const remote = this.meeting.remoteParticipants().find(p => p.screenSharing);
    if (remote) {
      return { userId: remote.userId, displayName: remote.displayName, isMine: false, stream: this.meeting.peers().get(remote.userId)?.screenStream ?? null };
    }
    if (this.screenSharing()) {
      return { userId: this.myUserId() ?? 'me', displayName: 'You', isMine: true, stream: this.meeting.localScreenStream() };
    }
    return null;
  });
  /** Alternancia "View camera / View screen" mientras hay pantalla. */
  readonly mainView = signal<'screen' | 'camera'>('screen');
  readonly showScreenMain = computed(() => !!this.activeShare() && this.mainView() === 'screen');
  readonly sharingLabel = computed(() => {
    const share = this.activeShare();
    return share ? (share.isMine ? "You're sharing" : `${share.displayName} is sharing`) : null;
  });

  toggleMainView(): void {
    this.mainView.update(view => (view === 'screen' ? 'camera' : 'screen'));
  }

  // ---------- F5: manos, reacciones, chat compacto, PiP ----------
  readonly raisedHandCount = this.meeting.raisedHandCount;
  readonly reactionsEnabled = this.meeting.reactionsEnabled;
  readonly reactionCatalog = computed(() => this.meeting.reactionsPolicy()?.catalog ?? []);
  readonly reactionPickerOpen = signal(false);
  readonly floatingReactions = this.meeting.reactions;
  readonly chatOpen = signal(false);
  readonly chatUnread = this.meeting.chatUnread;
  readonly chatDraft = signal('');
  readonly chatMessages = computed(() => this.meeting.chatMessages().slice(-COMPACT_CHAT_MESSAGES));
  readonly pipSupported = this.pip.supported;
  readonly pipActive = this.pip.active;
  /** Filas con Admit directo y cuántos más esperan. */
  readonly waitingRows = computed(() => this.waitingParticipants().slice(0, WAITING_ROWS));
  readonly waitingMore = computed(() => Math.max(0, this.waitingParticipants().length - WAITING_ROWS));

  reactionFor(userId: string): MeetingReaction | null {
    return this.meeting.reactionByUser().get(userId) ?? null;
  }

  reactionMs(r: MeetingReaction): string {
    return `${Math.max(0, r.expiresAtMs - r.shownAtMs)}ms`;
  }

  barsOf(userId: string): number {
    return this.speaker.barsOf(userId === this.myUserId() ? SELF_LEVEL_KEY : userId);
  }

  toggleReactionPicker(): void {
    this.reactionPickerOpen.update(open => !open);
  }

  react(emoji: string): void {
    void this.meeting.react(emoji);
  }

  toggleChat(): void {
    const open = !this.chatOpen();
    this.chatOpen.set(open);
    if (open) {
      this.meeting.markChatRead();
    }
  }

  sendChat(): void {
    const text = this.chatDraft().trim();
    if (!text) {
      return;
    }
    this.meeting.sendChatMessage(text);
    this.chatDraft.set('');
  }

  admit(userId: string): void {
    this.meeting.admit(userId);
  }

  deny(userId: string): void {
    this.meeting.deny(userId);
  }

  onTileHostAction(event: ParticipantTileHostAction): void {
    this.meeting.performHostAction(event.action as MeetingHostTileAction, event.userId);
  }

  popOut(): void {
    void this.pip.toggle();
  }

  readonly recordingRequesterName = computed(() => {
    const id = this.recordingConsentFrom();
    return this.meeting.participants().find(p => p.userId === id)?.displayName ?? 'A participant';
  });

  /** F3 — aviso de tiempo (10/5/1 min) también minimizado. */
  readonly durationWarningText = computed(() => {
    const w = this.meeting.durationWarning();
    return w ? `Ends in ${durationWarningLabel(w.remainingSeconds)}` : null;
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
        return this.meeting.endedTitle();
      default:
        // F3: reloj transcurrido / restante (contra el servidor) también minimizado.
        return `Live · ${this.participantCount()} ${this.participantCount() === 1 ? 'participant' : 'participants'} · ${this.meeting.clockLabel()}`;
    }
  });

  // ---------- Layout: colapsado, posición y arrastre ----------
  readonly collapsed = signal(readStorage(COLLAPSED_KEY) === '1');
  readonly isDesktop = signal(isDesktopViewport());
  readonly position = signal<MiniPlayerPoint | null>(parseStoredPosition(readStorage(POSITION_KEY)));
  readonly dragging = signal(false);
  private dragOffset: MiniPlayerPoint = { x: 0, y: 0 };
  /** Tamaño medido del panel y del viewport (para esquivar el overlay de llamada sin tocar la posición guardada). */
  private readonly panelSize = signal<MiniPlayerSize>(DEFAULT_PANEL_SIZE);
  private readonly viewportSize = signal<MiniPlayerSize>(readViewport());
  /** Posición efectiva: la elegida (o la esquina) corrida a la izquierda si el overlay de llamada la pisa (T-58). */
  readonly effectivePosition = computed(() =>
    avoidReservedCorner(this.position(), this.panelSize(), this.viewportSize(), this.callVisible() ? CALL_OVERLAY_SIZE : null),
  );
  /** Clases de posición: en la ventana PiP el panel llena todo; si no, esquina/arrastre o barra inferior. */
  readonly panelClass = computed(() => {
    if (this.pipActive()) {
      return 'inset-0 rounded-none';
    }
    const base = 'inset-x-2 rounded-3xl sm:left-auto sm:w-[min(22rem,calc(100vw-1rem))]';
    const corner = this.isDesktop() && this.effectivePosition() ? 'sm:right-auto sm:bottom-auto' : 'sm:right-4 sm:bottom-4';
    const bottom = this.callVisible() ? 'bottom-[11.5rem]' : 'bottom-2';
    return `${base} ${corner} ${bottom}`;
  });

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
          this.toast.info(this.meeting.endedTitle());
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

    // F5 — el panel se registra en el servicio de PiP (Document PiP lo mueve de ventana).
    effect(() => {
      const panel = this.panelRef()?.nativeElement ?? null;
      untracked(() => this.pip.registerPanel(panel));
    });
    this.pip.registerMainVideo(() => this.panelRef()?.nativeElement.querySelector('video') ?? null, {
      toggleMicrophone: () => this.toggleAudio(),
      toggleCamera: () => this.toggleVideo(),
      hangup: () => this.leave(),
    });

    // Al empezar/terminar una pantalla, el principal vuelve a ser la pantalla.
    effect(() => {
      this.activeShare();
      untracked(() => this.mainView.set('screen'));
    });

    // Chat compacto abierto (sin la sala) → sonido de "mensaje recibido" en vez del aviso general.
    effect(() => {
      if (!this.meeting.roomViewAttached()) {
        this.meeting.chatPanelOpen.set(this.chatOpen());
      }
    });
  }

  screenAudioVolume(userId: string): number {
    return this.speaker.screenAudioVolume(userId);
  }

  setScreenAudioVolume(userId: string, value: string | number): void {
    this.speaker.setScreenAudioVolume(userId, Number(value));
  }

  shareScreen(request: ScreenShareRequest): void {
    void this.meeting.startScreenShare(request.withAudio);
  }

  stopScreenShare(): void {
    void this.meeting.stopScreenShare();
  }

  swapMicrophone(deviceId: string): void {
    void this.meeting.swapMicrophone(deviceId);
  }

  swapCamera(deviceId: string): void {
    void this.meeting.swapCamera(deviceId);
  }

  // ---------- Controles ----------

  toggleAudio(): void {
    this.meeting.toggleAudio();
  }

  toggleVideo(): void {
    void this.meeting.toggleVideo();
  }

  toggleHand(): void {
    void this.meeting.toggleHandRaise();
  }

  /** Vuelve a la sala completa: /meetings la muestra sola si hay meeting activo (sin re-unirse). */
  expand(): void {
    this.pip.close();
    void this.router.navigateByUrl('/meetings');
  }

  /** F6 — "Invite" minimizado: la sala se abre con el panel de invitaciones (la página consume el flag). */
  requestInvite(): void {
    this.session.invitePanelRequested.set(true);
    this.expand();
  }

  leave(): void {
    // leave() resetea a 'idle' (no pasa por 'ended'), así que no hay toast de "terminó" que evitar.
    this.pip.close();
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
      this.pip.close();
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
    return userId === this.myUserId() ? this.selfSpeaking() : this.speakingIds().has(userId);
  }

  streamFor(userId: string): MediaStream | null {
    return this.meeting.peers().get(userId)?.cameraStream ?? null;
  }

  // ---------- Arrastre (pointer events, solo escritorio) ----------

  onDragStart(event: PointerEvent): void {
    const panel = this.panelRef()?.nativeElement;
    // Los botones del encabezado no inician arrastre; en móvil el panel es una barra fija; en PiP no se mueve.
    if (!panel || !this.isDesktop() || this.pipActive() || event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    this.dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.dragging.set(true);
    event.preventDefault();
  }

  onDragMove(event: PointerEvent): void {
    const panel = this.panelRef()?.nativeElement;
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
    this.viewportSize.set(readViewport());
    this.reclamp();
  }

  private reclamp(): void {
    const panel = this.panelRef()?.nativeElement;
    if (panel && panel.offsetWidth && panel.offsetHeight) {
      this.panelSize.set({ width: panel.offsetWidth, height: panel.offsetHeight });
    }
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

function readViewport(): MiniPlayerSize {
  return typeof window !== 'undefined' ? { width: window.innerWidth, height: window.innerHeight } : { width: 0, height: 0 };
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
