import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type TicketCategory = 'Technical issue' | 'Billing' | 'Feature request' | 'Other';

const CATEGORIES: TicketCategory[] = ['Technical issue', 'Billing', 'Feature request', 'Other'];

/**
 * Mini-formulario de tickets del módulo Support (estilo "Aether"): input
 * píldora, dropdown de categoría (patrón document:click como dashboard-filters)
 * y textarea. Al enviar se muestra un chip de confirmación y se resetea el
 * formulario — todo local, sin backend.
 */
@Component({
  selector: 'app-support-ticket-form',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './support-ticket-form.component.html',
})
export class SupportTicketFormComponent {
  readonly categories = CATEGORIES;

  readonly subject = signal('');
  readonly category = signal<TicketCategory>('Technical issue');
  readonly message = signal('');
  readonly isCategoryOpen = signal(false);
  readonly submittedTicketId = signal<string | null>(null);

  readonly canSubmit = computed(() => this.subject().trim().length > 0 && this.message().trim().length > 0);

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

  selectCategory(category: TicketCategory): void {
    this.category.set(category);
    this.isCategoryOpen.set(false);
  }

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    const id = Math.floor(4000 + Math.random() * 900).toString();
    this.submittedTicketId.set(id);
    this.subject.set('');
    this.category.set('Technical issue');
    this.message.set('');
  }

  dismissConfirmation(): void {
    this.submittedTicketId.set(null);
  }
}
