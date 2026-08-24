import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * Composer del AI Assistant (estilo "Aether"): input píldora + botón circular
 * de enviar.
 *
 * Hoy la página lo monta SIEMPRE deshabilitado: no existe ningún servicio de IA
 * detrás (el Gateway no expone cluster ni ruta `ai-*`), así que no hay a dónde
 * enviar el mensaje. Se conservan `send` y `disabled` para cuando exista backend
 * real; se quitaron los chips de sugerencia porque prometían capacidades
 * ("¿qué deducciones aplican...?") que el producto no puede cumplir.
 */
@Component({
  selector: 'app-ai-chat-composer',
  imports: [FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './ai-chat-composer.component.html',
})
export class AiChatComposerComponent {
  @Input() disabled = false;
  /** Texto del input vacío: la página lo usa para explicar por qué está bloqueado. */
  @Input() placeholder = 'Write a message...';
  @Output() send = new EventEmitter<string>();

  readonly draft = signal('');

  submit(): void {
    const text = this.draft().trim();
    if (!text || this.disabled) {
      return;
    }
    this.send.emit(text);
    this.draft.set('');
  }
}
