import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { formatDueDate } from '@shared/ui/form-review/form-review.format';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { StatusPillComponent, type StatusTone } from '@shared/ui/status-pill/status-pill.component';
import type { ClientFormRequestRow } from '../../data-access/client-forms.model';

@Component({
  selector: 'app-client-form-request-list',
  imports: [StateBlockComponent, StatusPillComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-state-block
      [loading]="loading"
      [error]="error"
      [empty]="!loading && !error && requests.length === 0"
      emptyTitle="No client forms yet"
      emptyMessage="Assign a published form to collect structured information."
      icon="document-text-outline"
      variant="inline"
      (retry)="retry.emit()"
    >
      <div class="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        @for (request of requests; track request.id) {
          <button
            type="button"
            class="grid w-full gap-4 p-4 text-left hover:bg-gray-50 sm:grid-cols-[minmax(0,1fr)_9rem_8rem] sm:items-center"
            (click)="opened.emit(request.id)"
          >
            <span class="min-w-0">
              <span class="block truncate font-semibold text-gray-900">{{ request.title }}</span>
              <span class="mt-1 block text-xs text-gray-500"
                >{{ request.templateName }} · Revision
                {{ request.currentRevisionNumber || 0 }}</span
              >
              <span class="mt-3 block h-1.5 overflow-hidden rounded-full bg-gray-100"
                ><span
                  class="block h-full rounded-full bg-brand-bold"
                  [style.width.%]="request.progressPercent"
                ></span
              ></span>
            </span>
            <span
              class="text-sm"
              [class.font-bold]="request.isOverdue"
              [class.text-red-700]="request.isOverdue"
              [class.text-gray-500]="!request.isOverdue"
            >
              {{ request.isOverdue ? 'Overdue' : due(request.dueAtUtc) }}
            </span>
            <span class="flex items-center justify-between gap-3">
              <app-status-pill [tone]="tone(request.status)" [soft]="true" size="xs">{{
                label(request.status)
              }}</app-status-pill>
              <ion-icon name="chevron-forward-outline" class="text-gray-400"></ion-icon>
            </span>
          </button>
        }
      </div>
    </app-state-block>
  `,
})
export class FormRequestListComponent {
  @Input() requests: readonly ClientFormRequestRow[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;
  @Output() readonly opened = new EventEmitter<string>();
  @Output() readonly retry = new EventEmitter<void>();

  // Fecha de calendario: se formatea en UTC para no correrse un día en EE. UU.
  due(value: string | null): string {
    const date = formatDueDate(value, { month: 'short', day: 'numeric' });
    return date ? `Due ${date}` : 'No due date';
  }

  label(status: string): string {
    return status === 'Submitted' ? 'Needs review' : status;
  }

  tone(status: string): StatusTone {
    if (status === 'Completed') return 'success';
    if (status === 'Submitted') return 'warning';
    if (status === 'Returned') return 'info';
    if (status === 'Cancelled') return 'muted';
    return 'neutral';
  }
}
