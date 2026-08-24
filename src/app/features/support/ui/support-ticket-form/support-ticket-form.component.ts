import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  SUPPORT_CATEGORY_OPTIONS,
  SupportCategory,
  SupportTicketFormValue,
} from '../../data-access/support.model';

/**
 * Mini-formulario de tickets del módulo Support (estilo "Aether"): input
 * píldora, dropdown de categoría (patrón document:click como dashboard-filters)
 * y textarea. Componente dumb: emite `SupportTicketFormValue` y el contenedor
 * (support-page) lo manda al backend vía SupportStore; el chip de confirmación
 * muestra el `ticketId` real que llega por input. Cuando ese input pasa a un
 * valor nuevo (ticket creado), el formulario se resetea solo (ngOnChanges).
 */
@Component({
  selector: 'app-support-ticket-form',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './support-ticket-form.component.html',
})
export class SupportTicketFormComponent implements OnChanges {
  /** POST en vuelo: deshabilita el botón y muestra "Sending...". */
  @Input() submitting = false;
  /** Id real devuelto por el backend; non-null = mostrar chip de confirmación. */
  @Input() submittedTicketId: string | null = null;
  /** Mensaje de error del POST (ya normalizado por toApiError en el store). */
  @Input() errorMessage: string | null = null;

  @Output() submitTicket = new EventEmitter<SupportTicketFormValue>();
  @Output() dismissConfirmation = new EventEmitter<void>();

  readonly categories = SUPPORT_CATEGORY_OPTIONS;

  readonly subject = signal('');
  readonly category = signal<SupportCategory>('Technical');
  readonly message = signal('');
  readonly isCategoryOpen = signal(false);

  readonly categoryLabel = computed(
    () => this.categories.find(option => option.value === this.category())?.label ?? this.category(),
  );

  readonly canSubmit = computed(() => this.subject().trim().length > 0 && this.message().trim().length > 0);

  ngOnChanges(changes: SimpleChanges): void {
    // Ticket creado con éxito -> limpiar los campos (el chip lo muestra el input).
    const change = changes['submittedTicketId'];
    if (change && !change.firstChange && change.currentValue) {
      this.subject.set('');
      this.category.set('Technical');
      this.message.set('');
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="ticket-category"]') && this.isCategoryOpen()) {
      this.isCategoryOpen.set(false);
    }
  }

  toggleCategoryDropdown(): void {
    this.isCategoryOpen.update(open => !open);
  }

  selectCategory(category: SupportCategory): void {
    this.category.set(category);
    this.isCategoryOpen.set(false);
  }

  submit(): void {
    if (!this.canSubmit() || this.submitting) {
      return;
    }
    this.submitTicket.emit({
      subject: this.subject().trim(),
      category: this.category(),
      description: this.message().trim(),
    });
  }
}
