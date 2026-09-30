import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { MeetingParticipantDto } from '@core/communication/meeting.model';
import { meetingAvatarColorFor, meetingInitialsFor } from '../../data-access/meeting.model';

/**
 * Lista de participantes del meeting (presentacional). Manos levantadas primero, luego host/co-host y
 * el resto por orden de llegada. Incluye la sala de espera (solo host) y las acciones de host por
 * participante, más "fijar" (pin) — también es el destino del tile "+N" de la grilla.
 */
@Component({
  selector: 'app-meeting-participants-panel',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meeting-participants-panel.component.html',
})
export class MeetingParticipantsPanelComponent {
  @Input() participants: MeetingParticipantDto[] = [];
  @Input() waiting: MeetingParticipantDto[] = [];
  @Input() myUserId: string | null = null;
  @Input() isHost = false;
  @Input() pinnedUserId: string | null = null;
  @Input() speakingIds: ReadonlySet<string> = new Set();

  @Output() closed = new EventEmitter<void>();
  @Output() pinToggle = new EventEmitter<string>();
  @Output() admit = new EventEmitter<string>();
  @Output() deny = new EventEmitter<string>();
  @Output() remove = new EventEmitter<string>();
  @Output() promote = new EventEmitter<string>();
  @Output() demote = new EventEmitter<string>();
  @Output() makeHost = new EventEmitter<string>();

  readonly openMenuFor = signal<string | null>(null);

  get sorted(): MeetingParticipantDto[] {
    const rank = (p: MeetingParticipantDto): number => (p.role === 'Host' ? 0 : p.role === 'Cohost' ? 1 : 2);
    return [...this.participants].sort(
      (a, b) => Number(b.handRaised) - Number(a.handRaised) || rank(a) - rank(b) || a.joinOrder - b.joinOrder,
    );
  }

  get raisedCount(): number {
    return this.participants.filter(p => p.handRaised).length;
  }

  isMe(p: MeetingParticipantDto): boolean {
    return p.userId === this.myUserId;
  }

  roleLabel(p: MeetingParticipantDto): string | null {
    return p.role === 'Host' ? 'Host' : p.role === 'Cohost' ? 'Co-host' : null;
  }

  initials(name: string): string {
    return meetingInitialsFor(name);
  }

  avatarColor(seed: string): string {
    return meetingAvatarColorFor(seed);
  }

  toggleMenu(userId: string): void {
    this.openMenuFor.update(cur => (cur === userId ? null : userId));
  }

  run(action: EventEmitter<string>, userId: string): void {
    this.openMenuFor.set(null);
    action.emit(userId);
  }
}
