import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Output,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { ActiveMeetingService } from '@core/communication/active-meeting.service';
import { SrcObjectDirective } from '@core/communication/src-object.directive';
import { MeetingParticipantDto } from '@core/communication/meeting.model';
import { meetingAvatarColorFor, meetingInitialsFor } from '../../data-access/meeting.model';

/**
 * Sala de meeting real (mesh ≤4). Reflejo del ActiveMeetingService:
 * joining / sala de espera / no-soportado (SFU) / dentro (tiles de video mesh:
 * local + un peer por participante) / terminado.
 */
@Component({
  selector: 'app-meeting-room',
  imports: [CommonModule, FormsModule, SrcObjectDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-room.component.html',
})
export class MeetingRoomComponent {
  private readonly meeting = inject(ActiveMeetingService);
  private readonly auth = inject(AuthService);

  @Output() left = new EventEmitter<void>();

  readonly phase = this.meeting.phase;
  readonly title = this.meeting.meetingTitle;
  readonly participants = this.meeting.joinedParticipants;
  readonly remoteParticipants = this.meeting.remoteParticipants;
  readonly waitingParticipants = this.meeting.waitingParticipants;
  readonly isLocked = this.meeting.isLocked;
  readonly isHost = this.meeting.isHost;
  readonly errorMessage = this.meeting.errorMessage;
  readonly localStream = this.meeting.localStream;
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
  private readonly peers = this.meeting.peers;

  /** getDisplayMedia solo existe en escritorio. */
  readonly canScreenShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  /** Grabar: soporte MediaRecorder + permiso communication.meeting.record. */
  readonly canRecord = computed(
    () =>
      typeof MediaRecorder !== 'undefined' &&
      (this.auth.currentUser()?.permissions.includes('communication.meeting.record') ?? false),
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

  /** userId de la tile con el menú de host abierto (o null). */
  readonly openMenuUserId = signal<string | null>(null);

  /** userId del tile "destacado" (spotlight) o null (galería). Click en un tile lo alterna. */
  readonly spotlightUserId = signal<string | null>(null);
  /** Última capa espacial pedida por peer, para no re-emitir de más (default del server = 2). */
  private readonly lastLayerByUser = new Map<string, number>();

  toggleSpotlight(userId: string): void {
    this.spotlightUserId.update(cur => (cur === userId ? null : userId));
  }

  // ---------- Chat del meeting ----------
  readonly chatOpen = signal(false);
  readonly chatUnread = signal(0);
  readonly chatDraft = signal('');
  private prevChatLen = 0;

  constructor() {
    // Badge de no-leídos: cuenta mensajes ajenos nuevos mientras el panel está cerrado.
    effect(() => {
      const msgs = this.chatMessages();
      const added = msgs.slice(this.prevChatLen);
      this.prevChatLen = msgs.length;
      if (!this.chatOpen()) {
        const fromOthers = added.filter(m => !m.isMine).length;
        if (fromOthers) {
          this.chatUnread.update(u => u + fromOthers);
        }
      }
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

  toggleChat(): void {
    const open = !this.chatOpen();
    this.chatOpen.set(open);
    if (open) {
      this.chatUnread.set(0);
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

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('[data-dropdown="meeting-peer-menu"]')) {
      this.openMenuUserId.set(null);
    }
  }

  streamFor(userId: string): MediaStream | null {
    return this.peers().get(userId)?.stream ?? null;
  }

  toggleMenu(userId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuUserId.set(this.openMenuUserId() === userId ? null : userId);
  }

  // Host actions (cierran el menú)
  admit(userId: string): void {
    this.meeting.admit(userId);
  }
  deny(userId: string): void {
    this.meeting.deny(userId);
  }
  remove(userId: string): void {
    this.closeMenu();
    this.meeting.removeParticipant(userId);
  }
  toggleLock(): void {
    this.meeting.toggleLock();
  }
  muteAll(): void {
    this.meeting.muteAll();
  }
  makeHost(userId: string): void {
    this.closeMenu();
    this.meeting.transferHost(userId);
  }
  promote(userId: string): void {
    this.closeMenu();
    this.meeting.promoteCohost(userId);
  }
  demote(userId: string): void {
    this.closeMenu();
    this.meeting.demoteCohost(userId);
  }
  private closeMenu(): void {
    this.openMenuUserId.set(null);
  }

  leave(): void {
    void this.meeting.leave();
    this.left.emit();
  }

  toggleAudio(): void {
    this.meeting.toggleAudio();
  }
  toggleVideo(): void {
    this.meeting.toggleVideo();
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

  initials(name: string): string {
    return meetingInitialsFor(name);
  }
  avatarColor(seed: string): string {
    return meetingAvatarColorFor(seed);
  }
  roleLabel(p: MeetingParticipantDto): string | null {
    return p.role === 'Host' ? 'Host' : p.role === 'Cohost' ? 'Co-host' : null;
  }
}
