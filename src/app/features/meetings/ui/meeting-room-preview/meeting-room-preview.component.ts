import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MeetingItem } from '../../data-access/meeting.model';

/** Tope de mosaicos dibujados (la grilla deja de ser legible más allá de esto). */
const MAX_TILES = 4;

/**
 * Vista previa estática de la sala de reunión (sin WebRTC real): grilla de
 * mosaicos anónimos en vez de video, y una barra de controles inferior donde
 * solo mic/cámara alternan un estado visual local. "Leave meeting" emite `left`
 * para volver a la lista.
 *
 * El listado del backend solo expone `joinedParticipantsCount`, no quién está
 * dentro, así que los mosaicos son anónimos: no se inventan nombres ni avatares.
 */
@Component({
  selector: 'app-meeting-room-preview',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-room-preview.component.html',
})
export class MeetingRoomPreviewComponent {
  @Input() meeting: MeetingItem | null = null;
  @Output() left = new EventEmitter<void>();

  readonly isMicOn = signal(true);
  readonly isCameraOn = signal(true);
  readonly isSharingScreen = signal(false);

  /** Mosaicos para los demás participantes (el propio usuario ya tiene el suyo fijo). */
  otherParticipantSlots(): number[] {
    const others = Math.max(0, (this.meeting?.joinedCount ?? 1) - 1);
    return Array.from({ length: Math.min(others, MAX_TILES - 1) }, (_, index) => index + 1);
  }

  toggleMic(): void {
    this.isMicOn.update(on => !on);
  }

  toggleCamera(): void {
    this.isCameraOn.update(on => !on);
  }

  toggleShareScreen(): void {
    this.isSharingScreen.update(on => !on);
  }

  leave(): void {
    this.left.emit();
  }
}
