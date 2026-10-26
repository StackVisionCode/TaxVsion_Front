import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { dueDateInputValue, dueDateToUtc, earliestDueDate } from './form-review.format';

export type FormReviewAction = 'return' | 'complete' | 'cancel' | 'archive' | 'dueDate';

export interface FormReviewActionResult {
  kind: FormReviewAction;
  /** Mensaje (obligatorio en `return`) o nota opcional. */
  note: string | null;
  /** Solo en `dueDate`: medianoche UTC del día elegido, o null para quitarla. */
  dueAtUtc: string | null;
}

const HEADINGS: Record<FormReviewAction, string> = {
  return: 'Request changes',
  complete: 'Complete request',
  cancel: 'Cancel request',
  archive: 'Archive request',
  dueDate: 'Change due date',
};

/** Diálogo de las acciones de revisión (devolver, completar, cancelar, archivar y fecha límite). */
@Component({
  selector: 'app-form-review-action-dialog',
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [isOpen]="kind() != null" [heading]="heading()" size="md" (closed)="closed.emit()">
      <form class="space-y-4 p-6" novalidate (submit)="submit($event)">
        @if (error()) {
          <p
            role="alert"
            class="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {{ error() }}
          </p>
        }
        @if (kind() === 'dueDate') {
          <label class="block text-sm font-semibold text-gray-700"
            >Due date
            <input
              type="date"
              class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3"
              [min]="minDueDate"
              [value]="text()"
              (input)="text.set(value($event))"
            />
          </label>
          <p class="text-xs text-gray-500">Leave it empty to remove the due date.</p>
        } @else {
          <label class="block text-sm font-semibold text-gray-700">
            {{ kind() === 'return' ? 'Message to client' : 'Note' }}
            @if (kind() === 'return') {
              <span class="font-normal text-gray-500">Required</span>
            } @else {
              <span class="font-normal text-gray-400">Optional</span>
            }
            <textarea
              class="mt-1 w-full rounded-xl border p-3"
              [class.border-gray-300]="!messageMissing()"
              [class.border-red-400]="messageMissing()"
              rows="4"
              [maxLength]="maxLength"
              [required]="kind() === 'return'"
              [attr.aria-invalid]="messageMissing()"
              [attr.aria-describedby]="messageMissing() ? 'form-review-message-error' : null"
              [value]="text()"
              (input)="text.set(value($event))"
            ></textarea>
          </label>
          @if (messageMissing()) {
            <p id="form-review-message-error" class="text-xs font-semibold text-red-700">
              Write a message so the client knows what to change.
            </p>
          }
          @if (kind() === 'return') {
            <p class="text-xs text-gray-500">
              {{ commentCount() }} field comment(s) will be included.
            </p>
          }
        }
        <div class="flex justify-end gap-3">
          <button
            type="button"
            class="min-h-10 rounded-full border border-gray-300 px-4 text-sm font-semibold"
            (click)="closed.emit()"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="min-h-10 rounded-full bg-brand-bold px-4 text-sm font-bold text-white disabled:opacity-50"
            [disabled]="busy()"
          >
            {{ busy() ? 'Saving…' : 'Confirm' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class FormReviewActionDialogComponent {
  readonly kind = input<FormReviewAction | null>(null);
  readonly busy = input(false);
  readonly dueAtUtc = input<string | null>(null);
  readonly commentCount = input(0);
  /** Error de la última acción: se ve aquí porque el aviso del drawer queda detrás del modal. */
  readonly error = input<string | null>(null);
  readonly confirmed = output<FormReviewActionResult>();
  readonly closed = output<void>();

  readonly text = signal('');
  readonly attempted = signal(false);
  // Mismo tope que el backend (FormRequest.ReturnForChanges / Complete / Cancel).
  readonly maxLength = 2000;
  readonly minDueDate = earliestDueDate();
  readonly heading = computed(() => {
    const kind = this.kind();
    return kind ? HEADINGS[kind] : '';
  });
  readonly ready = computed(() => {
    const kind = this.kind();
    if (kind === 'return') return this.text().trim().length > 0;
    if (kind === 'dueDate') return !this.text() || dueDateToUtc(this.text()) != null;
    return kind != null;
  });
  readonly messageMissing = computed(
    () => this.attempted() && this.kind() === 'return' && this.text().trim().length === 0,
  );

  constructor() {
    // Cada apertura arranca limpia; la fecha parte del día UTC guardado.
    effect(() => {
      const kind = this.kind();
      untracked(() => {
        this.attempted.set(false);
        this.text.set(kind === 'dueDate' ? dueDateInputValue(this.dueAtUtc()) : '');
      });
    });
  }

  submit(event: Event): void {
    event.preventDefault();
    const kind = this.kind();
    this.attempted.set(true);
    if (!kind || !this.ready() || this.busy()) return;
    const text = this.text().trim();
    this.confirmed.emit({
      kind,
      note: kind === 'dueDate' ? null : text || null,
      dueAtUtc: kind === 'dueDate' && text ? dueDateToUtc(text) : null,
    });
  }

  value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }
}
