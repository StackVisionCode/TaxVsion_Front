import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * Composer del módulo SMS (estilo "Aether"): input píldora + botón circular
 * negro de enviar, igual que el composer del Chat pero sin adjuntar
 * archivos (los SMS son solo texto). Al enviar, emite el texto y limpia el
 * borrador; la transición de estado "Sent" → "Delivered" la simula el
 * componente padre (sms-page) con un setTimeout tras recibir el evento.
 */
@Component({
  selector: 'app-sms-composer',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './sms-composer.component.html',
})
export class SmsComposerComponent {
  @Output() send = new EventEmitter<string>();

  readonly draft = signal('');

  submit(): void {
    const text = this.draft().trim();
    if (!text) {
      return;
    }
    this.send.emit(text);
    this.draft.set('');
  }
}
