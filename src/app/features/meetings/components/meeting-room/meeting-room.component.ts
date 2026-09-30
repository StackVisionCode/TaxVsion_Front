import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostListener,
  Output,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PermissionService } from '@core/auth/permission.service';
import { ActiveMeetingService } from '@core/communication/active-meeting.service';
import { SrcObjectDirective } from '@core/communication/src-object.directive';
import { MeetingParticipantDto } from '@core/communication/meeting.model';
import { ConnectionBars } from '@core/communication/connection-quality.util';
import { MEETING_REACTIONS } from '@core/communication/meeting-reactions';
import { meetingAvatarColorFor, meetingInitialsFor } from '../../data-access/meeting.model';
import { MeetingTileComponent } from '../../ui/meeting-tile/meeting-tile.component';
import { MeetingFloatingPanelComponent } from '../../ui/meeting-floating-panel/meeting-floating-panel.component';
import { MeetingParticipantsPanelComponent } from '../../ui/meeting-participants-panel/meeting-participants-panel.component';
import { MeetingChatPanelComponent, MeetingChatViewMessage } from '../../ui/meeting-chat-panel/meeting-chat-panel.component';
import { MeetingReactionPickerComponent } from '../../ui/meeting-reaction-picker/meeting-reaction-picker.component';
import { TileCandidate, computeGridLayout, maxTilesFor, selectVisibleTiles } from '../../utils/meeting-grid.util';
import {
  FloatingPosition,
  loadFloatingPosition,
  loadPinnedParticipant,
  saveFloatingPosition,
  savePinnedParticipant,
} from '../../utils/meeting-room-storage.util';

/** Vista de un tile (local o remoto), lista para el componente presentacional. */
interface TileVm {
  id: string;
  name: string;
  initials: string;
  avatarClass: string;
  stream: MediaStream | null;
  videoOn: boolean;
  audioOn: boolean;
  isLocal: boolean;
  handRaised: boolean;
  speaking: boolean;
  quality: ConnectionBars;
  roleLabel: string | null;
  pinned: boolean;
  canPin: boolean;
  participant: MeetingParticipantDto | null;
}

type SidePanel = 'chat' | 'people' | null;

/** Separación entre tiles de la grilla (px CSS, igual al `gap` del template). */
const GRID_GAP = 12;
/** Mínimo usable de alto de la sala en pantallas muy bajas (móvil apaisado). */
const MIN_ROOM_HEIGHT = 320;
/** Padding inferior del shell (p-4) — igual que el chat. */
const SHELL_BOTTOM_PADDING = 16;
/** Desde este ancho de sala, chat/participantes van como columna lateral; debajo, como overlay. */
const WIDE_ROOM_MIN_WIDTH = 1024;

/**
 * Sala de meeting (contenedor): refleja el ActiveMeetingService (joining / espera / passcode /
 * no-soportado / dentro / terminado) y arma la vista:
 * - Galería: grilla calculada con ResizeObserver sobre el escenario (zoom/rotación/paneles), con un
 *   tope de tiles según el espacio y un tile "+N" que abre la lista de participantes.
 * - Escenario: la pantalla compartida (o el participante fijado) ocupa el centro y las cámaras van a
 *   un panel flotante arrastrable acoplado abajo-izquierda (posición recordada en la sesión).
 * - Paneles de chat/participantes: columna lateral en pantallas anchas, overlay en móvil/tablet.
 * El audio remoto lo reproducen `<audio>` dedicados (siempre montados), no los tiles.
 */
@Component({
  selector: 'app-meeting-room',
  imports: [
    FormsModule,
    SrcObjectDirective,
    MeetingTileComponent,
    MeetingFloatingPanelComponent,
    MeetingParticipantsPanelComponent,
    MeetingChatPanelComponent,
    MeetingReactionPickerComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-room.component.html',
  styleUrl: './meeting-room.component.css',
  host: {
    class: 'block',
    '[style.height.px]': 'fillHeight()',
  },
})
export class MeetingRoomComponent {
  private readonly perms = inject(PermissionService);
  private readonly meeting = inject(ActiveMeetingService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  @Output() left = new EventEmitter<void>();

  readonly phase = this.meeting.phase;
  readonly title = this.meeting.meetingTitle;
  readonly participants = this.meeting.joinedParticipants;
  readonly remoteParticipants = this.meeting.remoteParticipants;
  readonly waitingParticipants = this.meeting.waitingParticipants;
  readonly raisedHands = this.meeting.raisedHands;
  readonly isLocked = this.meeting.isLocked;
  readonly isHost = this.meeting.isHost;
  readonly yourRole = this.meeting.yourRole;
  readonly errorMessage = this.meeting.errorMessage;
  readonly localStream = this.meeting.localStream;
  readonly localScreenStream = this.meeting.localScreenStream;
  readonly audioEnabled = this.meeting.audioEnabled;
  readonly videoEnabled = this.meeting.videoEnabled;
  readonly handRaised = this.meeting.handRaised;
  readonly screenSharing = this.meeting.screenSharing;
  readonly strategy = this.meeting.strategy;
  readonly recordingState = this.meeting.recordingState;
  readonly recordingElapsedLabel = this.meeting.recordingElapsedLabel;
  readonly recordingConsentFrom = this.meeting.recordingConsentFrom;
  readonly isRecordingRequester = this.meeting.isRecordingRequester;
  readonly speakingIds = this.meeting.speakingUserIds;
  readonly lowBandwidth = this.meeting.lowBandwidth;
  readonly reactions = this.meeting.reactions;
  readonly ending = this.meeting.ending;
  readonly myUserId = this.meeting.myUserId;
  private readonly peers = this.meeting.peers;
  private readonly quality = this.meeting.connectionQuality;
  private readonly localKey = this.meeting.localMediaKey;

  readonly reactionOptions = MEETING_REACTIONS;

  /** getDisplayMedia solo existe en escritorio. */
  readonly canScreenShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  /** Grabar: soporte MediaRecorder + permiso communication.meeting.record. */
  readonly canRecord = computed(() => typeof MediaRecorder !== 'undefined' && this.perms.has('communication.meeting.record'));
  readonly isRecording = computed(() => this.recordingState() === 'Recording');
  readonly isRecordingBusy = computed(() => ['Requesting', 'Stopping', 'Processing'].includes(this.recordingState()));
  readonly showRecordButton = computed(() => this.phase() === 'joined' && this.canRecord() && this.recordingState() === 'Idle');
  /** Nombre del que pidió grabar (para el modal de consentimiento), desde el roster. */
  readonly recordingRequesterName = computed(() => {
    const id = this.recordingConsentFrom();
    return this.participants().find(p => p.userId === id)?.displayName ?? 'A participant';
  });

  // ---------- Layout (medido) ----------

  /** Alto de la sala = viewport visible debajo de su borde superior (como el chat): zoom/teclado-safe. */
  readonly fillHeight = signal<number | null>(null);
  /** Tamaño real del escenario (ResizeObserver) — base de la grilla. */
  readonly stageSize = signal<{ width: number; height: number }>({ width: 0, height: 0 });
  /** Ancho de la sala: decide si los paneles van al costado o encima. */
  private readonly roomWidth = signal(0);
  readonly isWide = computed(() => this.roomWidth() >= WIDE_ROOM_MIN_WIDTH);
  private readonly stageRef = viewChild<ElementRef<HTMLElement>>('stage');

  // ---------- Paneles / popovers ----------
  readonly sidePanel = signal<SidePanel>(null);
  readonly chatUnread = signal(0);
  readonly reactionPickerOpen = signal(false);
  readonly leaveMenuOpen = signal(false);
  readonly hostMenuOpen = signal(false);
  private prevChatLen = 0;

  // ---------- Pin (persistido por meeting) ----------
  readonly pinnedUserId = signal<string | null>(null);
  private pinLoadedFor: string | null = null;
  /** El pin solo aplica si esa persona está dentro ahora (si no, se conserva guardado para cuando vuelva). */
  readonly effectivePinned = computed(() => {
    const id = this.pinnedUserId();
    return id && this.remoteParticipants().some(p => p.userId === id) ? id : null;
  });

  // ---------- Panel flotante ----------
  readonly floatingPosition = signal<FloatingPosition | null>(loadFloatingPosition());

  /** Passcode que el usuario tipea cuando el meeting lo exige (fase 'passcode'). */
  readonly passcodeDraft = signal('');

  constructor() {
    this.watchViewport();

    // Badge de no-leídos: cuenta mensajes ajenos nuevos mientras el chat está cerrado.
    effect(() => {
      const msgs = this.meeting.chatMessages();
      const added = msgs.slice(this.prevChatLen);
      this.prevChatLen = msgs.length;
      if (untracked(this.sidePanel) !== 'chat') {
        const fromOthers = added.filter(m => !m.isMine).length;
        if (fromOthers) {
          this.chatUnread.update(u => u + fromOthers);
        }
      }
    });

    // Restaurar el pin guardado al entrar (o re-entrar) a un meeting.
    effect(() => {
      const id = this.meeting.meetingId();
      if (id !== this.pinLoadedFor) {
        this.pinLoadedFor = id;
        this.pinnedUserId.set(id ? loadPinnedParticipant(id) : null);
      }
    });

    // Escenario medido: se (re)observa cada vez que el elemento aparece (cambia de fase / modo).
    effect(onCleanup => {
      const el = this.stageRef()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') {
        return;
      }
      const measure = (): void => {
        const rect = el.getBoundingClientRect();
        const next = { width: Math.floor(rect.width), height: Math.floor(rect.height) };
        const prev = untracked(this.stageSize);
        if (prev.width !== next.width || prev.height !== next.height) {
          this.stageSize.set(next);
        }
      };
      measure();
      const observer = new ResizeObserver(() => measure());
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    });

    // Capas de simulcast (solo SFU): alta para el fijado / galería chica, baja para miniaturas,
    // ocultos (+N) y cámaras mientras hay pantalla compartida; todo baja en modo bajo ancho de banda.
    effect(() => {
      if (this.strategy() !== 'Sfu') {
        return;
      }
      const low = this.lowBandwidth();
      const mode = this.stageMode();
      const pinned = this.effectivePinned();
      const remotes = this.remoteParticipants();
      const visible = new Set(this.gallery().tiles.map(t => t.id));
      const seen = new Set<string>();
      for (const p of remotes) {
        seen.add(p.userId);
        let want: number;
        if (low || mode === 'share') {
          want = 0;
        } else if (mode === 'pinned') {
          want = p.userId === pinned ? 2 : 0;
        } else {
          want = visible.has(p.userId) ? (remotes.length <= 3 ? 2 : 1) : 0;
        }
        const prev = this.lastLayerByUser.has(p.userId) ? this.lastLayerByUser.get(p.userId)! : 2;
        if (prev !== want) {
          this.meeting.setPeerPreferredLayers(p.userId, want, want === 2 ? 2 : 1);
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

  /** Última capa espacial pedida por peer, para no re-emitir de más (default del server = 2). */
  private readonly lastLayerByUser = new Map<string, number>();

  // ---------- Tiles ----------

  readonly tiles = computed<TileVm[]>(() => {
    const speaking = this.speakingIds();
    const quality = this.quality();
    const localKey = this.localKey();
    const pinned = this.effectivePinned();
    const peers = this.peers();
    const me = this.participants().find(p => p.userId === this.myUserId()) ?? null;
    const local: TileVm = {
      id: localKey,
      name: me?.displayName ?? 'You',
      initials: 'You',
      avatarClass: 'bg-brand-bold',
      stream: this.localStream(),
      videoOn: this.videoEnabled() && !!this.localStream(),
      audioOn: this.audioEnabled(),
      isLocal: true,
      handRaised: this.handRaised(),
      speaking: speaking.has(localKey),
      quality: quality.get(localKey) ?? 0,
      roleLabel: this.roleLabelFor(this.yourRole()),
      pinned: false,
      canPin: false,
      participant: me,
    };
    const remotes = this.remoteParticipants().map<TileVm>(p => {
      const stream = peers.get(p.userId)?.cameraStream ?? null;
      return {
        id: p.userId,
        name: p.displayName,
        initials: meetingInitialsFor(p.displayName),
        avatarClass: meetingAvatarColorFor(p.userId),
        stream,
        videoOn: p.videoEnabled && !!stream,
        audioOn: p.audioEnabled,
        isLocal: false,
        handRaised: p.handRaised,
        speaking: speaking.has(p.userId),
        quality: quality.get(p.userId) ?? 0,
        roleLabel: this.roleLabelFor(p.role),
        pinned: p.userId === pinned,
        canPin: true,
        participant: p,
      };
    });
    return [local, ...remotes];
  });

  private candidate(t: TileVm): TileCandidate {
    return {
      id: t.id,
      isLocal: t.isLocal,
      pinned: t.pinned,
      handRaised: t.handRaised,
      speaking: t.speaking,
      joinOrder: t.participant?.joinOrder ?? 0,
    };
  }

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

  /** Cuál screen share va al escenario (el usuario puede elegir si hay varias; default = la más reciente). */
  readonly selectedShareUserId = signal<string | null>(null);
  readonly activeShare = computed(() => {
    const shares = this.screenShares();
    if (shares.length === 0) return null;
    return shares.find(s => s.userId === this.selectedShareUserId()) ?? shares[shares.length - 1];
  });

  /** gallery = grilla; share = pantalla al centro; pinned = participante fijado al centro. */
  readonly stageMode = computed<'gallery' | 'share' | 'pinned'>(() =>
    this.activeShare() ? 'share' : this.effectivePinned() ? 'pinned' : 'gallery',
  );

  readonly pinnedTile = computed(() => {
    const id = this.effectivePinned();
    return id ? (this.tiles().find(t => t.id === id) ?? null) : null;
  });

  /** Galería: cuántos tiles caben (según el escenario medido) y cuáles se ven; el resto → "+N". */
  readonly gallery = computed(() => {
    const { width, height } = this.stageSize();
    const all = this.tiles();
    const minTileWidth = width < 640 ? 132 : 200;
    const max = width && height ? maxTilesFor(width, height, minTileWidth, GRID_GAP) : all.length;
    const selection = selectVisibleTiles(all.map(t => this.candidate(t)), max);
    const byId = new Map(all.map(t => [t.id, t]));
    const tiles = selection.visible.map(id => byId.get(id)!).filter(Boolean);
    const cells = tiles.length + (selection.overflow > 0 ? 1 : 0);
    const layout = computeGridLayout(width, height, cells, GRID_GAP);
    const hiddenNames = all.filter(t => !selection.visible.includes(t.id)).map(t => t.name);
    return { tiles, overflow: selection.overflow, layout, hiddenNames };
  });

  /** Panel flotante (modo escenario): cámaras que no están en el centro, con tope y "+N". */
  readonly floating = computed(() => {
    const all = this.tiles().filter(t => t.id !== this.effectivePinned() || this.stageMode() === 'share');
    const max = this.stageSize().width < 640 ? 2 : 4;
    const selection = selectVisibleTiles(all.map(t => this.candidate(t)), max);
    const byId = new Map(all.map(t => [t.id, t]));
    return { tiles: selection.visible.map(id => byId.get(id)!).filter(Boolean), overflow: selection.overflow, total: all.length };
  });

  /** Mensajes del chat con el badge de rol del remitente (cruzado con el roster actual). */
  readonly chatView = computed<MeetingChatViewMessage[]>(() => {
    const roles = new Map(this.participants().map(p => [p.userId, this.roleLabelFor(p.role)]));
    return this.meeting.chatMessages().map(m => ({
      id: m.id,
      senderName: m.senderName,
      senderRole: roles.get(m.senderId) ?? null,
      text: m.text,
      time: m.time,
      isMine: m.isMine,
    }));
  });

  // ---------- Acciones ----------

  submitPasscode(): void {
    void this.meeting.submitPasscode(this.passcodeDraft());
  }

  selectShare(userId: string): void {
    this.selectedShareUserId.set(userId);
  }

  togglePin(userId: string): void {
    const next = this.pinnedUserId() === userId ? null : userId;
    this.pinnedUserId.set(next);
    const meetingId = this.meeting.meetingId();
    if (meetingId) {
      savePinnedParticipant(meetingId, next);
    }
  }

  onFloatingMoved(pos: FloatingPosition | null): void {
    this.floatingPosition.set(pos);
    saveFloatingPosition(pos);
  }

  openPanel(panel: Exclude<SidePanel, null>): void {
    const next = this.sidePanel() === panel ? null : panel;
    this.sidePanel.set(next);
    if (next === 'chat') {
      this.chatUnread.set(0);
    }
  }

  /** Abre (sin alternar) la lista de participantes — destino del "+N", del chip de manos y de la sala de espera. */
  showParticipants(): void {
    this.sidePanel.set('people');
  }

  closePanel(): void {
    this.sidePanel.set(null);
  }

  sendChat(text: string): void {
    this.meeting.sendChatMessage(text);
  }

  toggleReactionPicker(event: MouseEvent): void {
    event.stopPropagation();
    this.leaveMenuOpen.set(false);
    this.reactionPickerOpen.update(v => !v);
  }

  react(emoji: string): void {
    this.meeting.sendReaction(emoji);
    this.reactionPickerOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-popover="meeting-reactions"]')) {
      this.reactionPickerOpen.set(false);
    }
    if (!target.closest('[data-popover="meeting-leave"]')) {
      this.leaveMenuOpen.set(false);
    }
    if (!target.closest('[data-popover="meeting-host"]')) {
      this.hostMenuOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.reactionPickerOpen() || this.leaveMenuOpen() || this.hostMenuOpen()) {
      this.reactionPickerOpen.set(false);
      this.leaveMenuOpen.set(false);
      this.hostMenuOpen.set(false);
      return;
    }
    if (!this.isWide()) {
      this.sidePanel.set(null);
    }
  }

  // Host actions
  admit(userId: string): void {
    this.meeting.admit(userId);
  }
  deny(userId: string): void {
    this.meeting.deny(userId);
  }
  remove(userId: string): void {
    this.meeting.removeParticipant(userId);
  }
  toggleLock(): void {
    this.hostMenuOpen.set(false);
    this.meeting.toggleLock();
  }
  muteAll(): void {
    this.hostMenuOpen.set(false);
    this.meeting.muteAll();
  }
  makeHost(userId: string): void {
    this.meeting.transferHost(userId);
  }
  promote(userId: string): void {
    this.meeting.promoteCohost(userId);
  }
  demote(userId: string): void {
    this.meeting.demoteCohost(userId);
  }

  /** Salir: el teardown del service es inmediato (no espera al server); la página vuelve a la lista. */
  leave(): void {
    this.leaveMenuOpen.set(false);
    void this.meeting.leave();
    this.left.emit();
  }

  onLeaveClick(event: MouseEvent): void {
    // El host elige entre salir o terminar para todos; el resto sale directo.
    if (this.isHost()) {
      event.stopPropagation();
      this.reactionPickerOpen.set(false);
      this.leaveMenuOpen.update(v => !v);
      return;
    }
    this.leave();
  }

  async endForAll(): Promise<void> {
    this.leaveMenuOpen.set(false);
    if (await this.meeting.endForAll()) {
      this.left.emit();
    }
  }

  toggleAudio(): void {
    this.meeting.toggleAudio();
  }
  toggleVideo(): void {
    void this.meeting.toggleVideo();
  }
  toggleHand(): void {
    this.meeting.toggleHandRaise();
  }
  toggleScreenShare(): void {
    if (this.screenSharing()) {
      void this.meeting.stopScreenShare();
    } else {
      void this.meeting.startScreenShare();
    }
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

  /** Stream de CÁMARA de un peer (para su `<audio>`). */
  cameraStreamFor(userId: string): MediaStream | null {
    return this.peers().get(userId)?.cameraStream ?? null;
  }

  private roleLabelFor(role: MeetingParticipantDto['role']): string | null {
    return role === 'Host' ? 'Host' : role === 'Cohost' ? 'Co-host' : null;
  }

  /**
   * Recalcula el alto al montar y cuando cambia el espacio (resize, zoom, rotación, teclado móvil vía
   * visualViewport, o algo encima que cambie de alto — observado vía body). También mide el ancho de
   * la sala para decidir paneles laterales vs overlay.
   */
  private watchViewport(): void {
    const measure = (): void => {
      const el = this.host.nativeElement;
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const top = el.getBoundingClientRect().top + window.scrollY;
      this.fillHeight.set(Math.max(MIN_ROOM_HEIGHT, Math.floor(viewport - top - SHELL_BOTTOM_PADDING)));
      this.roomWidth.set(Math.floor(el.getBoundingClientRect().width));
    };
    afterNextRender(() => {
      measure();
      window.addEventListener('resize', measure);
      window.visualViewport?.addEventListener('resize', measure);
      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
      observer?.observe(document.body);
      observer?.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('resize', measure);
        window.visualViewport?.removeEventListener('resize', measure);
        observer?.disconnect();
      });
    });
  }
}
