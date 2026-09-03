import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * Composer del Chat de equipo (estilo "Aether"): botón de adjuntar real
 * (dispara un `<input type="file">` oculto), input píldora y botón circular
 * negro de enviar. Al enviar texto, emite y limpia el borrador; el adjunto
 * se emite aparte y el padre decide cuándo terminó de subir (`uploading`).
 */
@Component({
  selector: 'app-chat-composer',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './chat-composer.component.html',
})
export class ChatComposerComponent {
  @Input() uploading = false;
  @Output() send = new EventEmitter<string>();
  @Output() attach = new EventEmitter<File>();
  /** true en cada pulsación con texto, false al enviar o vaciar/blur. El padre lo throttlea al socket. */
  @Output() typing = new EventEmitter<boolean>();

  readonly draft = signal('');

  onDraftChange(value: string): void {
    this.draft.set(value);
    this.typing.emit(value.trim().length > 0);
  }

  onBlur(): void {
    this.typing.emit(false);
  }

  submit(): void {
    const text = this.draft().trim();
    if (!text) {
      return;
    }
    this.send.emit(text);
    this.draft.set('');
    this.typing.emit(false);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.attach.emit(file);
    }
    input.value = '';
  }
}
