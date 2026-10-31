import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { parseUtcDate } from '@shared/utils/utc-date.util';
import type { MessageEditsDto } from '../chat-message.model';

/**
 * F8 (D-64) — "edited" → versiones de un mensaje: el texto actual arriba y debajo lo que decía antes,
 * de la más reciente a la original, con la hora en que se reemplazó. Transparencia para ambos lados.
 */
@Component({
  selector: 'app-message-edits-dialog',
  imports: [ModalComponent, InfinityLoaderComponent],
  template: `
    <app-modal [isOpen]="isOpen" heading="Edit history" size="sm" (closed)="closed.emit()">
      @if (loading) {
        <div class="mt-4 flex items-center gap-2 text-sm text-gray-400"><app-infinity-loader size="xs" /> Loading…</div>
      } @else if (error) {
        <p class="mt-4 text-sm text-red-600" data-role="edits-error">{{ error }}</p>
      } @else if (edits) {
        <ol class="mt-4 flex flex-col gap-3" data-role="edit-versions">
          <li class="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2">
            <p class="text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-400">Current · {{ time(edits.editedAtUtc) }}</p>
            <p class="mt-1 whitespace-pre-wrap break-words text-sm text-gray-900">{{ edits.currentBody }}</p>
          </li>
          @for (version of olderFirst(); track version.revision) {
            <li class="px-3">
              <p class="text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-400">
                {{ version.revision === 1 ? 'Original' : 'Version ' + version.revision }} · replaced {{ time(version.replacedAtUtc) }}
              </p>
              <p class="mt-1 whitespace-pre-wrap break-words text-sm text-gray-500">{{ version.body }}</p>
            </li>
          }
        </ol>
      }
    </app-modal>
  `,
})
export class MessageEditsDialogComponent {
  @Input() isOpen = false;
  @Input() edits: MessageEditsDto | null = null;
  @Input() loading = false;
  @Input() error: string | null = null;
  @Output() closed = new EventEmitter<void>();

  olderFirst(): MessageEditsDto['versions'] {
    return [...(this.edits?.versions ?? [])].sort((a, b) => b.revision - a.revision);
  }

  time(iso: string | null): string {
    if (!iso) return '';
    const date = parseUtcDate(iso);
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
}
