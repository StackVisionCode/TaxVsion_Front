import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { PermissionService } from '@core/auth/permission.service';
import { FormsModule } from '@angular/forms';
import { ActiveMeetingService, MeetingHostTileAction } from '@core/communication/active-meeting.service';
import { SrcObjectDirective } from '@core/communication/src-object.directive';
import { MeetingActiveSpeakerService, SELF_LEVEL_KEY } from '@core/communication/meeting-active-speaker.service';
import { MeetingPipService } from '@core/communication/meeting-pip.service';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { TooltipDirective } from '@shared/ui/tooltip/tooltip.directive';
import { MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { MeetingParticipantDto } from '@core/communication/meeting.model';
import { durationWarningLabel } from '@core/communication/meeting-clock.util';
import { MediaControlsComponent, ScreenShareRequest } from '@core/communication/ui/media-controls/media-controls.component';
import { DevicePanelComponent } from '@core/communication/ui/device-panel/device-panel.component';
import { RecordingConsentComponent } from '@core/communication/ui/recording-consent/recording-consent.component';
import { LobbyJoinOptions, MediaLobbyComponent } from '@core/communication/ui/media-lobby/media-lobby.component';
import { MeetingParticipantTileComponent, ParticipantTileHostAction } from '@core/communication/ui/participant-tile/participant-tile.component';
import { MeetingParticipantsPanelComponent } from '@core/communication/ui/participants-panel/participants-panel.component';
import { ReactionPickerComponent } from '@core/communication/ui/reaction-picker/reaction-picker.component';
import { computeGalleryLayout } from '@core/communication/ui/participant-tile/gallery-layout.util';
import { MediaDevicesService } from '@core/communication/media/media-devices.service';
import { MediaPolicyService } from '@core/communication/media/media-policy.service';
import type { MeetingReaction } from '@core/communication/meeting-reactions.util';

/** Reunión a la que se va a entrar: la sala muestra el lobby (pre-join) antes de `join()`. */
export interface MeetingLobbyTarget {
  meetingId: string;
  title: string;
}

/** actorTypes de staff: ven las cifras del badge de calidad (D-39). */
const STAFF_ACTORS = ['TenantEmployee', 'TenantAdmin', 'PlatformAdmin'] as const;
/** Galería: a partir de aquí los demás se resumen en "+N" (T-57). */
const MAX_GALLERY_TILES = 12;
/** Separación entre tiles de la galería (px, = gap-3). */
const GALLERY_GAP_PX = 12;

/**
 * Sala de meeting real (mesh ≤4 / SFU). Reflejo del ActiveMeetingService:
 * lobby (pre-join, `@defer`) / joining / sala de espera / passcode / dentro / terminado.
 * F4: controles comunes (`app-media-controls`), banner de red, panel Devices y consentimiento común.
 * F5: tile único (`app-meeting-participant-tile`) en galería, escenario (pantalla o fijado) y filmstrip;
 * galería por espacio medido (ResizeObserver, 16:9, "+N"); panel Participants (manos) y picker de
 * reacciones diferidos; burbujas flotantes + `aria-live`; chat como sheet en `< lg`; "More" en `< sm`;
 * "Pop out" (PiP) cuando el navegador lo soporta.
 * F6: "Invite" (host/cohost; cabecera, "More" y panel Participants) emite `inviteRequested` — el panel
 * de invitaciones lo monta la página (la sala no conoce el store). `guestMode` (página pública
 * `/meet/:token`): sin Invite ni grabación, pantalla solo si la política lo permite a clientes/guests,
 * pantalla de fin sin "Start a new meeting" y con "Close".
 */
@Component({
  selector: 'app-meeting-room',
  imports: [
    InfinityLoaderComponent,
    CommonModule,
    FormsModule,
    SrcObjectDirective,
    ConfirmDialogComponent,
    TooltipDirective,
    MenuItemDirective,
    MediaControlsComponent,
    DevicePanelComponent,
    RecordingConsentComponent,
    MediaLobbyComponent,
    MeetingParticipantTileComponent,
    MeetingParticipantsPanelComponent,
    ReactionPickerComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-room.component.html',
})
export class MeetingRoomComponent {
  private readonly perms = inject(PermissionService);
  private readonly meeting = inject(ActiveMeetingService);
  private readonly speaker = inject(MeetingActiveSpeakerService);
  private readonly devices = inject(MediaDevicesService);
  private readonly mediaPolicy = inject(MediaPolicyService);
  private readonly pip = inject(MeetingPipService);

  /** Con la fase en 'idle', muestra el lobby para esta reunión; null = sin lobby. */
  @Input() lobby: MeetingLobbyTarget | null = null;
  /** F6 — sala de invitado externo (sin JWT): ver cabecera. */
  @Input() guestMode = false;
  @Output() left = new EventEmitter<void>();
  /** El lobby terminó (entró o canceló): el padre limpia su `lobby`. */
  @Output() lobbyClosed = new EventEmitter<void>();
  /** F6 — el host quiere invitar: la página abre `app-meeting-invite-panel`. */
  @Output() inviteRequested = new EventEmitter<void>();

  /** Área de video (galería / escenario), medida para la galería por espacio. */
  private readonly stageArea = viewChild<ElementRef<HTMLElement>>('stageArea');

  readonly phase = this.meeting.phase;
  readonly title = this.meeting.meetingTitle;
  readonly participants = this.meeting.joinedParticipants;
  readonly remoteParticipants = this.meeting.remoteParticipants;
  readonly waitingParticipants = this.meeting.waitingParticipants;
  readonly isLocked = this.meeting.isLocked;
  readonly isHost = this.meeting.isHost;
  readonly isPrimaryHost = this.meeting.isPrimaryHost;
  readonly canEndForAll = this.meeting.canEndForAll;
  /** F3 — reloj "transcurrido / restante", aviso de tiempo y pantalla de fin con motivo. */
  readonly clockLabel = this.meeting.clockLabel;
  readonly remainingSeconds = this.meeting.remainingSeconds;
  readonly durationWarning = this.meeting.durationWarning;
  readonly durationWarningText = computed(() => {
    const w = this.durationWarning();
    return w ? `This meeting ends in ${durationWarningLabel(w.remainingSeconds)}` : null;
  });
  readonly endedTitle = this.meeting.endedTitle;
  /** "Start a new meeting" (D-34): solo host/cohost y solo cuando la reunión terminó de verdad (no si expiró sin arrancar). */
  readonly canStartContinuation = computed(
    () => this.meeting.meetingEnded() && this.canEndForAll() && this.meeting.endReason() !== 'Expired',
  );
  readonly continuationBusy = signal(false);
  /** Remotos hablando ahora (anillo en su tile). El audio lo reproduce el mini-player global. */
  readonly speakingIds = this.speaker.speakingIds;
  readonly selfSpeaking = this.speaker.selfSpeaking;
  readonly audioSuspended = this.speaker.audioSuspended;
  readonly errorMessage = this.meeting.errorMessage;
  readonly localStream = this.meeting.localStream;
  readonly localScreenStream = this.meeting.localScreenStream;
  readonly audioEnabled = this.meeting.audioEnabled;
  readonly videoEnabled = this.meeting.videoEnabled;
  readonly handRaised = this.meeting.handRaised;
  readonly screenSharing = this.meeting.screenSharing;
  readonly strategy = this.meeting.strategy;
  readonly chatMessages = this.meeting.chatMessages;
  readonly recordingState = this.meeting.recordingState;
  readonly recordingElapsedLabel = this.meeting.recordingElapsedLabel;
  readonly recordingConsentFrom = this.meeting.recordingConsentFrom;
  readonly isRecordingRequester = this.meeting.isRecordingRequester;
  /** F5 — mi fila del roster con mi estado local encima (tile "You"). */
  readonly self = this.meeting.selfParticipant;
  readonly nowMs = this.meeting.nowMs;
  /** F1 — enlace de media (ok / reconnecting / failed) y aviso de "Resume sharing" tras un re-join. */
  readonly mediaState = this.meeting.mediaState;
  readonly screenShareInterrupted = this.meeting.screenShareInterrupted;
  private readonly peers = this.meeting.peers;

  // ---------- F4: calidad, motivo de mute, dispositivos ----------
  readonly muteReason = this.meeting.muteReason;
  readonly videoPausedByNetwork = this.meeting.videoPausedByNetwork;
  readonly connectionQuality = this.meeting.connectionQuality;
  readonly connectionMetrics = this.meeting.connectionMetrics;
  readonly hasMicrophone = computed(() => !this.meeting.microphoneError());
  readonly waitingForPermission = this.devices.waitingForPermission;
  /** Cifras del badge (RTT/pérdida/jitter) solo para staff (D-39). */
  readonly showMetrics = computed(() => this.perms.isActor(...STAFF_ACTORS));
  readonly screenAudioAllowed = computed(() => this.mediaPolicy.policy()?.screenShare.audioAllowed ?? false);
  /** F6 (D-42) — el guest solo comparte pantalla si la política lo permite a clientes/guests. */
  readonly canShareScreen = computed(() => !this.guestMode || (this.mediaPolicy.policy()?.screenShare.clientsCanShare ?? false));
  /** F6 — "Invite" solo para host/cohost con sesión (nunca en la sala de invitado). */
  readonly canInvite = computed(() => this.isHost() && !this.guestMode);

  /** F6 — Invite desde la cabecera, "More" o el panel Participants. */
  requestInvite(): void {
    this.participantsOpen.set(false);
    this.inviteRequested.emit();
  }
  /** Banner no intrusivo de red: solo audio (D-40) o Poor. */
  readonly networkBanner = computed(() => {
    if (this.videoPausedByNetwork()) {
      return 'Video paused to protect audio';
    }
    return this.connectionQuality() === 'Poor' ? 'Your connection is unstable. Video quality reduced' : null;
  });
  readonly devicesOpen = signal(false);
  /** Audio de las pantallas compartidas (para el control de volumen del escenario). */
  readonly remoteScreenAudio = this.speaker.remoteScreenAudio;
  readonly activeShareHasAudio = computed(() => {
    const share = this.activeShare();
    return !!share && !share.isMine && this.remoteScreenAudio().some(s => s.userId === share.userId);
  });

  // ---------- F5: manos, reacciones, participantes, PiP ----------
  readonly raisedHandCount = this.meeting.raisedHandCount;
  readonly participantsOpen = signal(false);
  readonly reactionsEnabled = this.meeting.reactionsEnabled;
  readonly reactionCatalog = computed(() => this.meeting.reactionsPolicy()?.catalog ?? []);
  readonly reactionPickerOpen = signal(false);
  /** Reacciones vivas para la capa flotante del escenario. */
  readonly floatingReactions = this.meeting.reactions;
  readonly reactionAnnouncement = this.meeting.reactionAnnouncement;
  readonly pipSupported = this.pip.supported;
  readonly pipActive = this.pip.active;

  reactionFor(userId: string): MeetingReaction | null {
    return this.meeting.reactionByUser().get(userId) ?? null;
  }

  barsOf(userId: string): number {
    return this.speaker.barsOf(userId);
  }

  selfBars(): number {
    return this.speaker.barsOf(SELF_LEVEL_KEY);
  }

  reactionMs(r: MeetingReaction): string {
    return `${Math.max(0, r.expiresAtMs - r.shownAtMs)}ms`;
  }

  toggleReactionPicker(): void {
    this.reactionPickerOpen.update(open => !open);
  }

  react(emoji: string): void {
    void this.meeting.react(emoji);
  }

  popOut(): void {
    void this.pip.toggle();
  }

  /** Reintento del gesto cuando el navegador dejó el AudioContext suspendido. */
  enableAudio(): void {
    void this.speaker.primeAudioContext();
  }

  onTileHostAction(event: ParticipantTileHostAction): void {
    this.meeting.performHostAction(event.action as MeetingHostTileAction, event.userId);
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

  /** El lobby decidió: entrar con sus opciones (mic/cámara). El clic es el gesto que desbloquea el AudioContext. */
  joinFromLobby(options: LobbyJoinOptions): void {
    const target = this.lobby;
    if (!target) {
      return;
    }
    void this.speaker.primeAudioContext();
    void this.meeting.join(target.meetingId, target.title, options);
    this.lobbyClosed.emit();
  }

  cancelLobby(): void {
    this.lobbyClosed.emit();
    this.left.emit();
  }

  retryMedia(): void {
    void this.meeting.retryMedia();
  }
  resumeSharing(): void {
    void this.meeting.resumeSharing();
  }
  dismissResumeSharing(): void {
    this.meeting.dismissResumeSharing();
  }

  /** Grabar: soporte MediaRecorder + permiso communication.meeting.record (nunca el guest, F6). */
  readonly canRecord = computed(
    () =>
      typeof MediaRecorder !== 'undefined' &&
      !this.guestMode &&
      (this.perms.has('communication.meeting.record')),
  );
  readonly isRecording = computed(() => this.recordingState() === 'Recording');
  readonly isRecordingBusy = computed(() => ['Requesting', 'Stopping', 'Processing'].includes(this.recordingState()));
  readonly showRecordButton = computed(
    () => this.phase() === 'joined' && this.canRecord() && this.recordingState() === 'Idle',
  );
  /** Nombre del que pidió grabar (para el modal de consentimiento), desde el roster. */
  readonly recordingRequesterName = computed(() => {
    const id = this.recordingConsentFrom();
    return this.participants().find(p => p.userId === id)?.displayName ?? 'A participant';
  });

  /**
   * userId del tile "destacado" (spotlight) o null (galería). Click en un tile lo alterna. Vive en el
   * service para sobrevivir a la navegación y para que el mini-player lo use si nadie está hablando.
   */
  readonly spotlightUserId = this.meeting.pinnedUserId;
  /** Última capa espacial pedida por peer, para no re-emitir de más (default del server = 2). */
  private readonly lastLayerByUser = new Map<string, number>();

  toggleSpotlight(userId: string): void {
    this.spotlightUserId.update(cur => (cur === userId ? null : userId));
  }

  /** Passcode que el usuario tipea cuando el meeting lo exige (fase 'passcode'). */
  readonly passcodeDraft = signal('');

  submitPasscode(): void {
    void this.meeting.submitPasscode(this.passcodeDraft());
  }

  // ---------- Chat del meeting ----------
  readonly chatOpen = signal(false);
  /** No leídos: los cuenta el service (también los ve el mini-player). */
  readonly chatUnread = this.meeting.chatUnread;
  readonly chatDraft = signal('');

  // ---------- Galería por espacio (T-57) ----------
  private readonly stageSize = signal({ width: 0, height: 0 });
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    // Con la sala montada se oculta el mini-player global; al salir de /meetings (sin dejar el meeting)
    // se desmonta la sala y el mini-player toma el relevo con la sesión intacta.
    this.meeting.roomViewAttached.set(true);
    inject(DestroyRef).onDestroy(() => {
      this.meeting.roomViewAttached.set(false);
      this.meeting.chatPanelOpen.set(false); // sala desmontada (mini-player): ya no hay chat a la vista
      this.resizeObserver?.disconnect();
    });
    // El service decide el sonido del mensaje entrante según si el chat está abierto.
    effect(() => this.meeting.chatPanelOpen.set(this.chatOpen()));

    // Área de video medida → filas × columnas de la galería.
    effect(() => {
      const el = this.stageArea()?.nativeElement;
      untracked(() => this.observeStage(el ?? null));
    });

    // Driver de spotlight → capas de simulcast (solo SFU): el destacado pide capa alta (spatial 2), los
    // thumbnails baja (spatial 0). Sin spotlight, todos quedan en el default (2) sin emitir. Se apoya en
    // `lastLayerByUser` para no re-emitir; el service es no-op en mesh.
    effect(() => {
      if (this.strategy() !== 'Sfu') {
        return;
      }
      const spot = this.spotlightUserId();
      const remotes = this.remoteParticipants();
      const seen = new Set<string>();
      for (const p of remotes) {
        seen.add(p.userId);
        const want = spot === null || p.userId === spot ? 2 : 0;
        const prev = this.lastLayerByUser.has(p.userId) ? this.lastLayerByUser.get(p.userId)! : 2;
        if (prev !== want) {
          this.meeting.setPeerPreferredLayers(p.userId, 'camera', want, want === 2 ? 2 : 1);
        }
        this.lastLayerByUser.set(p.userId, want);
      }
      for (const id of [...this.lastLayerByUser.keys()]) {
        if (!seen.has(id)) {
          this.lastLayerByUser.delete(id);
        }
      }
    });
  }

  private observeStage(el: HTMLElement | null): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.resizeObserver = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        this.stageSize.set({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
      }
    });
    this.resizeObserver.observe(el);
  }

  /** Galería: yo + remotos, con el layout medido. */
  readonly galleryParticipants = computed<MeetingParticipantDto[]>(() => [this.self(), ...this.remoteParticipants()]);
  readonly galleryLayout = computed(() => {
    const { width, height } = this.stageSize();
    return computeGalleryLayout(this.galleryParticipants().length, width, height, { gap: GALLERY_GAP_PX, maxTiles: MAX_GALLERY_TILES });
  });
  readonly visibleGallery = computed(() => this.galleryParticipants().slice(0, this.galleryLayout().visible));
  readonly galleryOverflow = computed(() => this.galleryLayout().overflow);
  /** Sin medida todavía (o sin ResizeObserver): columnas por conteo, como antes. */
  readonly galleryColsClass = computed(() => {
    const n = this.galleryParticipants().length;
    if (n <= 1) return 'grid-cols-1';
    if (n === 2) return 'grid-cols-1 sm:grid-cols-2';
    if (n <= 4) return 'grid-cols-2';
    if (n <= 6) return 'grid-cols-2 sm:grid-cols-3';
    return 'grid-cols-2 sm:grid-cols-4';
  });

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

  /** Stream de CÁMARA de un participante (la mía para `self`). */
  cameraStreamFor(userId: string): MediaStream | null {
    if (userId === this.myUserId()) {
      return this.localStream();
    }
    return this.peers().get(userId)?.cameraStream ?? null;
  }

  isSelf(p: MeetingParticipantDto): boolean {
    return p.userId === this.myUserId();
  }

  readonly myUserId = this.meeting.myUserId;

  /** Todas las pantallas que se están compartiendo (remotos + la mía), para el escenario y el selector. */
  readonly screenShares = computed<{ userId: string; displayName: string; isMine: boolean; stream: MediaStream | null }[]>(() => {
    const myId = this.myUserId();
    const shares: { userId: string; displayName: string; isMine: boolean; stream: MediaStream | null }[] = [];
    for (const p of this.remoteParticipants()) {
      if (p.screenSharing) {
        shares.push({ userId: p.userId, displayName: p.displayName, isMine: false, stream: this.peers().get(p.userId)?.screenStream ?? null });
      }
    }
    if (this.screenSharing()) {
      shares.push({ userId: myId ?? 'me', displayName: 'You', isMine: true, stream: this.localScreenStream() });
    }
    return shares;
  });

  readonly isSharing = computed(() => this.screenShares().length > 0);

  /** Cuál screen share va al escenario (el usuario puede elegir si hay varias; default = la más reciente). */
  readonly selectedShareUserId = signal<string | null>(null);
  readonly activeShare = computed(() => {
    const shares = this.screenShares();
    if (shares.length === 0) return null;
    return shares.find(s => s.userId === this.selectedShareUserId()) ?? shares[shares.length - 1];
  });

  /** Participante fijado (spotlight) presente; null si se fue o no hay. */
  readonly spotlightParticipant = computed(() => {
    const id = this.spotlightUserId();
    return id ? (this.galleryParticipants().find(p => p.userId === id) ?? null) : null;
  });
  /** Escenario: alguien comparte o hay un fijado. */
  readonly stageMode = computed(() => this.isSharing() || !!this.spotlightParticipant());
  /** Filmstrip del escenario: todos menos el fijado (si el principal es una pantalla, todos). */
  readonly filmstrip = computed(() => {
    const pinned = this.isSharing() ? null : this.spotlightParticipant();
    return this.galleryParticipants().filter(p => p.userId !== pinned?.userId);
  });

  selectShare(userId: string): void {
    this.selectedShareUserId.set(userId);
  }

  // Host actions (el menú de participante — app-dropdown-menu — se cierra solo al elegir)
  admit(userId: string): void {
    this.meeting.admit(userId);
  }
  deny(userId: string): void {
    this.meeting.deny(userId);
  }
  toggleLock(): void {
    this.meeting.toggleLock();
  }
  muteAll(): void {
    this.meeting.muteAll();
  }

  leave(): void {
    void this.meeting.leave();
    this.left.emit();
  }

  /** Pantalla de fin: vuelve a la lista sin avisar `meeting.leave` (ya no hay sala). */
  backToMeetings(): void {
    this.meeting.closeEnded();
    this.left.emit();
  }

  /** Pantalla de fin (host/cohost): crea la continuación, la inicia y entra. */
  async startNewMeeting(): Promise<void> {
    if (this.continuationBusy()) {
      return;
    }
    this.continuationBusy.set(true);
    try {
      await this.meeting.startContinuation();
    } finally {
      this.continuationBusy.set(false);
    }
  }

  // ---------- Terminar para todos (host y cohost, D-07) ----------
  readonly endConfirmOpen = signal(false);
  readonly endBusy = signal(false);

  async confirmEndForAll(): Promise<void> {
    if (this.endBusy()) {
      return;
    }
    this.endBusy.set(true);
    const ended = await this.meeting.endForAll();
    this.endBusy.set(false);
    this.endConfirmOpen.set(false);
    if (ended) {
      this.left.emit();
    }
  }

  isSpeaking(userId: string): boolean {
    return userId === this.myUserId() ? this.selfSpeaking() : this.speakingIds().has(userId);
  }

  toggleAudio(): void {
    this.meeting.toggleAudio();
  }
  toggleVideo(): void {
    this.meeting.toggleVideo();
  }
  toggleHand(): void {
    void this.meeting.toggleHandRaise();
  }

  toggleRecording(): void {
    if (this.isRecording() && this.isRecordingRequester()) {
      void this.meeting.stopRecording();
    } else if (this.recordingState() === 'Idle') {
      this.meeting.requestRecording();
    }
  }
  acceptRecording(): void {
    this.meeting.respondRecordingConsent(true);
  }
  declineRecording(): void {
    this.meeting.respondRecordingConsent(false);
  }
}
