import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SUPPORT_CATEGORY_OPTIONS, SupportCategory, SupportTicketFormValue } from '../../data-access/support.model';

/**
 * Formulario de "New ticket" (va dentro del diálogo de la bandeja). Componente dumb: emite el valor y el store
 * lo manda al backend; al crear, el diálogo se cierra y el ticket se abre al lado.
 */
@Component({
  selector: 'app-support-ticket-form',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './support-ticket-form.component.html',
})
export class SupportTicketFormComponent {
  /** POST en vuelo: deshabilita el envío y muestra "Sending…". */
  @Input() submitting = false;
  /** Error del POST (ya normalizado por toApiError en el store). */
  @Input() errorMessage: string | null = null;

  @Output() submitTicket = new EventEmitter<SupportTicketFormValue>();
  @Output() cancel = new EventEmitter<void>();

  readonly categories = SUPPORT_CATEGORY_OPTIONS;
  readonly subjectMax = 200;
  readonly messageMax = 4000;

  readonly subject = signal('');
  readonly category = signal<SupportCategory>('Technical');
  readonly message = signal('');

  readonly canSubmit = computed(() => this.subject().trim().length > 0 && this.message().trim().length > 0);

  submit(): void {
    if (!this.canSubmit() || this.submitting) return;
    this.submitTicket.emit({
      subject: this.subject().trim(),
      category: this.category(),
      description: this.message().trim(),
    });
  }
}
