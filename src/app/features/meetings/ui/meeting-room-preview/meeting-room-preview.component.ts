import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MeetingItem } from '../meeting-list/meeting-list.component';

/**
 * Vista previa estática de la sala de reunión (sin WebRTC real): grilla de
 * mosaicos con iniciales en vez de video, y una barra de controles inferior
 * donde solo mic/cámara alternan un estado visual local. "Leave meeting"
 * emite `left` para volver a la lista.
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

  toggleMic(): void {
    this.isMicOn.update(on => !on);
  }

  toggleCamera(): void {
    this.isCameraOn.update(on => !on);
  }

  leave(): void {
    this.left.emit();
  }
}
