import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SMS_BODY_MAX_LENGTH } from '../../data-access/sms.model';

/**
 * Composer del módulo SMS (estilo "Aether"): input píldora + botón circular negro,
 * igual que el composer del Chat pero sin adjuntar archivos (el endpoint acepta
 * media, pero la UI del módulo es solo texto). `disabled` lo controla la página:
 * cliente sin teléfono E.164 válido ⇒ no se puede enviar; `busy` bloquea el doble
 * click mientras POST /sms/messages está en vuelo. El tope de caracteres replica
 * el VO SmsBody del backend (4096) para no mandar cuerpos que serían rechazados.
 */
@Component({
  selector: 'app-sms-composer',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sms-composer.component.html',
})
export class SmsComposerComponent {
  @Input() disabled = false;
  @Input() busy = false;
  @Output() send = new EventEmitter<string>();

  readonly draft = signal('');
  readonly maxLength = SMS_BODY_MAX_LENGTH;

  submit(): void {
    const text = this.draft().trim();
    if (!text || this.disabled || this.busy) {
      return;
    }
    this.send.emit(text);
    this.draft.set('');
  }
}
