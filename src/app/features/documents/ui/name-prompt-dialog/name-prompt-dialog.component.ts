import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';

/**
 * Diálogo genérico de un solo campo de texto, reusado para "New folder" y
 * "Rename folder" (mismo formulario, distintas etiquetas) — evita duplicar dos
 * modales casi idénticos. El padre es dueño de `isOpen` y ejecuta la acción al
 * recibir `confirmed`.
 */
@Component({
  selector: 'app-name-prompt-dialog',
  imports: [FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <app-modal [isOpen]="isOpen" [heading]="heading" [subheading]="subheading" size="md" (closed)="cancelled.emit()">
      <div class="mt-5">
        <label class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-400" [attr.for]="'name-input'">
          {{ label }}
        </label>
        <input id="name-input" type="text" [ngModel]="value()" (ngModelChange)="value.set($event)"
          [placeholder]="placeholder" autocomplete="off" (keyup.enter)="submit()"
          class="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none transition-shadow focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
        @if (showSlashWarning()) {
          <p class="mt-2 text-xs text-red-500">Names can't contain slashes.</p>
        }
      </div>

      <div class="mt-6 flex items-center justify-end gap-2">
        <button type="button" (click)="cancelled.emit()"
          class="rounded-full px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900">
          Cancel
        </button>
        <button type="button" (click)="submit()" [disabled]="!canSubmit()"
          class="rounded-full bg-brand-bold px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-ink disabled:cursor-not-allowed disabled:opacity-50">
          {{ confirmLabel }}
        </button>
      </div>
    </app-modal>
  `,
})
export class NamePromptDialogComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() heading = 'New folder';
  @Input() subheading = '';
  @Input() label = 'Folder name';
  @Input() placeholder = '2025 Tax Return';
  @Input() confirmLabel = 'Create folder';
  @Input() initialValue = '';
  @Output() confirmed = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  readonly value = signal('');

  ngOnChanges(): void {
    if (this.isOpen) {
      this.value.set(this.initialValue);
    }
  }

  showSlashWarning(): boolean {
    return /[\\/]/.test(this.value());
  }

  canSubmit(): boolean {
    const trimmed = this.value().trim();
    return trimmed.length > 0 && !this.showSlashWarning();
  }

  submit(): void {
    if (this.canSubmit()) {
      this.confirmed.emit(this.value().trim());
    }
  }
}
