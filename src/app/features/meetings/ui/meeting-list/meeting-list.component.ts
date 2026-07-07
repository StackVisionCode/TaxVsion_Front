import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export type MeetingStatus = 'upcoming' | 'live' | 'ended' | 'cancelled';

export interface MeetingParticipant {
  name: string;
  initials: string;
  color: string;
}

export interface MeetingItem {
  id: string;
  title: string;
  client: string;
  /** ISO datetime string. */
  scheduledAt: string;
  durationMinutes: number;
  status: MeetingStatus;
  participants: MeetingParticipant[];
  hasRecording: boolean;
  notes: string;
}

/**
 * Lista de reuniones (patrón "Aether"): cada fila es una tarjeta con título,
 * cliente, fecha/hora formateada, duración, chip de estado y avatares
 * superpuestos de los participantes (+N si hay más de 4). Acciones: unirse
 * (upcoming/live), ver grabación (ended con grabación disponible) y un menú
 * fantasma con Editar/Cancelar. El clic en la fila (fuera de los botones)
 * también abre el modo edición.
 */
@Component({
  selector: 'app-meeting-list',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-list.component.html',
})
export class MeetingListComponent {
  @Input() meetings: MeetingItem[] = [];
  @Output() edit = new EventEmitter<MeetingItem>();
  @Output() cancel = new EventEmitter<MeetingItem>();
  @Output() join = new EventEmitter<MeetingItem>();

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

  visibleParticipants(meeting: MeetingItem): MeetingParticipant[] {
    return meeting.participants.slice(0, 4);
  }

  extraParticipantsCount(meeting: MeetingItem): number {
    return Math.max(0, meeting.participants.length - 4);
  }

  formatDateTime(iso: string): string {
    const date = new Date(iso);
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

  statusLabel(status: MeetingStatus): string {
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
    this.edit.emit(meeting);
  }

  onEditClick(meeting: MeetingItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.edit.emit(meeting);
  }

  onCancelClick(meeting: MeetingItem, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.cancel.emit(meeting);
  }

  onJoinClick(meeting: MeetingItem, event: MouseEvent): void {
    event.stopPropagation();
    this.join.emit(meeting);
  }
}
