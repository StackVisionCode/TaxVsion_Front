import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * Composer del Chat de equipo (estilo "Aether"): botón de adjuntar (solo
 * visual, sin selector de archivos real), input píldora y botón circular
 * negro de enviar. Al enviar, emite el texto y limpia el borrador.
 */
@Component({
  selector: 'app-chat-composer',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './chat-composer.component.html',
})
export class ChatComposerComponent {
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
