import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import type { FormTemplateVersionSummary } from '../../data-access/client-forms.model';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';

@Component({
  selector: 'app-version-history-drawer',
  imports: [DatePipe, DrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-drawer
      [isOpen]="isOpen"
      heading="Version history"
      subheading="Published versions are immutable."
      (closed)="closed.emit()"
    >
      <div class="space-y-3">
        @for (version of versions; track version.id) {
          <article class="rounded-2xl border border-gray-200 p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="font-bold text-gray-900">Version {{ version.versionNumber }}</h3>
                <p class="mt-1 text-xs text-gray-500">
                  {{ version.componentCount }} components ·
                  {{ version.publishedAtUtc | date: 'medium' }}
                </p>
              </div>
              <span
                class="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
                >Published</span
              >
            </div>
            <!-- Acciones en fila que baja de línea si el drawer es angosto. -->
            <div class="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                (click)="viewed.emit(version.versionNumber)"
              >
                View
              </button>
              <button
                type="button"
                class="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                [disabled]="restoreDisabled"
                [attr.title]="restoreDisabled ? 'Editing is paused in this tab' : null"
                (click)="restored.emit(version.versionNumber)"
              >
                Restore to draft
              </button>
              <button
                type="button"
                class="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                (click)="duplicated.emit(version.versionNumber)"
              >
                Duplicate
              </button>
            </div>
          </article>
        } @empty {
          <p class="py-10 text-center text-sm text-gray-500">No published versions yet.</p>
        }
      </div>
    </app-drawer>
  `,
})
export class VersionHistoryDrawerComponent {
  @Input() isOpen = false;
  @Input() versions: FormTemplateVersionSummary[] = [];
  /** Solo lectura o conflicto pendiente: restaurar reescribiría el draft. */
  @Input() restoreDisabled = false;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly viewed = new EventEmitter<number>();
  @Output() readonly restored = new EventEmitter<number>();
  @Output() readonly duplicated = new EventEmitter<number>();
}
