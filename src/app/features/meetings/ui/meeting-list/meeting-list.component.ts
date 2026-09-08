import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MeetingItem, MeetingUiStatus } from '../../data-access/meeting.model';
import { parseUtcDate } from '../../../../shared/utils/utc-date.util';

/**
 * Lista de reuniones contra el backend real (Communication). Cada fila es una
 * tarjeta con título, código de sala (copiable — es lo que usa el guest en
 * /by-code), fecha/hora, duración real (solo meetings terminadas) y chip de
 * estado. Acciones según contrato del backend:
 *  - Start/End: solo si el usuario es host (endpoints host-only).
 *  - Transcript: meetings terminadas con transcriptFileId.
 *  - Menú Manage/Cancel: solo host y solo Scheduled (reschedule/cancel
 *    rechazan cualquier otro estado).
 * "Join" a la sala no existe por REST (es Socket.IO + WebRTC) — no se ofrece.
 */
@Component({
  selector: 'app-meeting-list',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-list.component.html',
})
export class MeetingListComponent {
  @Input() meetings: MeetingItem[] = [];
  /** Id del meeting con una acción en curso: deshabilita sus botones. */
  @Input() busyId: string | null = null;
  @Output() manage = new EventEmitter<MeetingItem>();
  @Output() join = new EventEmitter<MeetingItem>();
  @Output() cancelMeeting = new EventEmitter<MeetingItem>();
  @Output() startMeeting = new EventEmitter<MeetingItem>();
  @Output() endMeeting = new EventEmitter<MeetingItem>();
  @Output() viewTranscript = new EventEmitter<MeetingItem>();
  @Output() copyCode = new EventEmitter<MeetingItem>();

  readonly openMenuId = signal<string | null>(null);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="meeting-menu"]')) {
      this.openMenuId.set(null);
    }
  }

  trackByMeetingId(_index: number, meeting: MeetingItem): string {
    return meeting.id;
  }

  /** Solo el host de un meeting Scheduled puede gestionarlo (reschedule/cancel/invitar). */
  canManage(meeting: MeetingItem): boolean {
    return meeting.isHost && meeting.status === 'upcoming';
  }

  isBusy(meeting: MeetingItem): boolean {
    return this.busyId === meeting.id;
  }

  formatDateTime(iso: string | null): string {
    if (!iso) {
      return 'Not scheduled';
    }
    const date = parseUtcDate(iso);
    const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${datePart} · ${timePart}`;
  }

  formatDuration(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }

  statusLabel(status: MeetingUiStatus): string {
    switch (status) {
      case 'upcoming':
        return 'Upcoming';
      case 'live':
        return 'Live';
      case 'ended':
        return 'Ended';
      case 'cancelled':
        return 'Cancelled';
    }
  }

  toggleMenu(meeting: MeetingItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(this.openMenuId() === meeting.id ? null : meeting.id);
  }

  onRowClick(meeting: MeetingItem): void {
    if (this.canManage(meeting)) {
      this.manage.emit(meeting);
    }
  }

  onManageClick(meeting: MeetingItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.manage.emit(meeting);
  }

  onCancelClick(meeting: MeetingItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.cancelMeeting.emit(meeting);
  }

  onStartClick(meeting: MeetingItem, event: MouseEvent): void {
    event.stopPropagation();
    this.startMeeting.emit(meeting);
  }

  onJoinClick(meeting: MeetingItem, event: MouseEvent): void {
    event.stopPropagation();
    this.join.emit(meeting);
  }

  onEndClick(meeting: MeetingItem, event: MouseEvent): void {
    event.stopPropagation();
    this.endMeeting.emit(meeting);
  }

  onTranscriptClick(meeting: MeetingItem, event: MouseEvent): void {
    event.stopPropagation();
    this.viewTranscript.emit(meeting);
  }

  onCopyCodeClick(meeting: MeetingItem, event: MouseEvent): void {
    event.stopPropagation();
    this.copyCode.emit(meeting);
  }
}
