import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * Composer del AI Assistant (estilo "Aether"): input píldora + botón circular
 * negro de enviar, más chips de sugerencia cuando el hilo está vacío.
 */
@Component({
  selector: 'app-ai-chat-composer',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './ai-chat-composer.component.html',
})
export class AiChatComposerComponent {
  @Input() disabled = false;
  @Input() showSuggestions = false;
  @Output() send = new EventEmitter<string>();

  readonly draft = signal('');

  readonly suggestions = [
    'What deductions apply to home offices?',
    "Summarize this client's filing status",
    'Draft a reminder email for missing W-2 forms',
  ];

  submit(): void {
    const text = this.draft().trim();
    if (!text || this.disabled) {
      return;
    }
    this.send.emit(text);
    this.draft.set('');
  }

  sendSuggestion(text: string): void {
    if (this.disabled) {
      return;
    }
    this.send.emit(text);
  }
}
