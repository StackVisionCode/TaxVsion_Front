import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MailMessage } from '../mail-list/mail-list.component';

/**
 * Panel de lectura del módulo Mail (estilo "Aether"): cabecera con asunto,
 * remitente (avatar + nombre + email + hora) y botones de acción tipo
 * "ghost" circulares (reply/reply-all/forward/archive/delete son solo
 * visuales; únicamente la estrella está sincronizada con la lista). Cuerpo
 * del correo en texto plano y dos filas de píldoras "Reply"/"Forward"
 * inertes al final. Muestra un estado vacío cuando no hay mensaje seleccionado.
 */
@Component({
  selector: 'app-mail-reading-pane',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-reading-pane.component.html',
})
export class MailReadingPaneComponent {
  @Input() message: MailMessage | null = null;
  @Output() starToggled = new EventEmitter<string>();

  toggleStar(): void {
    if (this.message) {
      this.starToggled.emit(this.message.id);
    }
  }
}
