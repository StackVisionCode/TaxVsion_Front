import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
} from '@angular/core';
import {
  dueDateToUtc,
  earliestDueDate,
  formatDueDate,
} from '@shared/ui/form-review/form-review.format';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import type { AssignableClientFormTemplate } from '../../data-access/client-forms.model';

export interface AssignFormDialogValue {
  templateId: string;
  title: string | null;
  messageToClient: string | null;
  dueAtUtc: string | null;
  taxYear: number | null;
  taskId: string | null;
  prefillFromRequestId: string | null;
}

@Component({
  selector: 'app-assign-form-dialog',
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen"
      heading="Assign client form"
      [subheading]="clientName"
      size="lg"
      (closed)="closed.emit()"
    >
      <form class="space-y-4 p-6" (submit)="submit($event)">
        <label class="block text-sm font-semibold text-gray-700"
          >Template
          <select
            required
            class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3"
            [value]="templateId()"
            (change)="templateId.set(value($event))"
          >
            <option value="" [selected]="!templateId()">Select a published template</option>
            @for (template of templates; track template.templateId) {
              <option [value]="template.templateId" [selected]="template.templateId === templateId()">
                {{ template.name }} · v{{ template.latestVersionNumber }}
              </option>
            }
          </select>
        </label>
        <label class="block text-sm font-semibold text-gray-700"
          >Request title
          <input
            class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3"
            maxlength="200"
            [value]="title()"
            (input)="title.set(value($event))"
          />
        </label>
        <label class="block text-sm font-semibold text-gray-700"
          >Message to client
          <textarea
            class="mt-1 w-full rounded-2xl border border-gray-300 p-3"
            rows="3"
            maxlength="1000"
            [value]="message()"
            (input)="message.set(value($event))"
          ></textarea>
        </label>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block text-sm font-semibold text-gray-700"
            >Due date
            <input
              type="date"
              class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3"
              [min]="minDueDate"
              [value]="dueDate()"
              (input)="dueDate.set(value($event))"
            />
            @if (dueDatePreview()) {
              <span class="mt-1 block text-xs font-normal text-gray-500"
                >Due {{ dueDatePreview() }}</span
              >
            }
          </label>
          <label class="block text-sm font-semibold text-gray-700"
            >Tax year
            <input
              type="number"
              min="1900"
              max="2200"
              class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3"
              [value]="taxYear()"
              (input)="taxYear.set(value($event))"
            />
          </label>
        </div>
        <label class="block text-sm font-semibold text-gray-700"
          >Client task ID <span class="font-normal text-gray-400">Optional</span>
          <input
            class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 px-3"
            [value]="taskId()"
            (input)="taskId.set(value($event))"
          />
        </label>
        <label class="block text-sm font-semibold text-gray-700"
          >Prefill from last year <span class="font-normal text-gray-400">Optional</span>
          <select
            class="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3"
            [value]="prefillFromRequestId()"
            (change)="prefillFromRequestId.set(value($event))"
          >
            <option value="">Do not prefill</option>
            @for (request of priorRequests; track request.id) {
              <option [value]="request.id" [selected]="request.id === prefillFromRequestId()">{{ request.title }}</option>
            }
          </select>
        </label>
        @if (error) {
          <p class="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{{ error }}</p>
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
            [disabled]="!templateId() || busy"
          >
            {{ busy ? 'Assigning…' : 'Assign form' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class AssignFormDialogComponent {
  @Input() isOpen = false;
  @Input() clientName = '';
  @Input() set templates(value: readonly AssignableClientFormTemplate[]) {
    this._templates = value ?? [];
    this.applyInitialTemplate();
  }
  get templates(): readonly AssignableClientFormTemplate[] {
    return this._templates;
  }
  @Input() priorRequests: readonly { id: string; title: string }[] = [];
  @Input() busy = false;
  @Input() error: string | null = null;
  /**
   * Plantilla preelegida (p. ej. al venir de "Send to external email" con un email de cliente).
   * Solo se aplica si está entre las asignables; las plantillas pueden llegar después.
   */
  @Input() set initialTemplateId(value: string | null) {
    this._initialTemplateId = value;
    this.applyInitialTemplate();
  }
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly assigned = new EventEmitter<AssignFormDialogValue>();

  private _templates: readonly AssignableClientFormTemplate[] = [];
  private _initialTemplateId: string | null = null;
  readonly templateId = signal('');
  readonly title = signal('');
  readonly message = signal('');
  readonly dueDate = signal('');
  readonly taxYear = signal('');
  readonly taskId = signal('');
  readonly prefillFromRequestId = signal('');
  readonly minDueDate = earliestDueDate();
  // La fecha viaja como medianoche UTC y se muestra como fecha de calendario (en UTC).
  readonly dueDatePreview = computed(() => formatDueDate(dueDateToUtc(this.dueDate())));

  submit(event: Event): void {
    event.preventDefault();
    if (!this.templateId() || this.busy) return;
    const year = Number(this.taxYear());
    this.assigned.emit({
      templateId: this.templateId(),
      title: this.title().trim() || null,
      messageToClient: this.message().trim() || null,
      dueAtUtc: dueDateToUtc(this.dueDate()),
      taxYear: Number.isInteger(year) && year > 0 ? year : null,
      taskId: this.taskId().trim() || null,
      prefillFromRequestId: this.prefillFromRequestId() || null,
    });
  }

  private applyInitialTemplate(): void {
    const initial = this._initialTemplateId;
    if (initial && this._templates.some((template) => template.templateId === initial))
      this.templateId.set(initial);
  }

  value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }
}
