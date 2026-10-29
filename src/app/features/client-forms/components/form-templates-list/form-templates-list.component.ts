import { DatePipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  inject,
} from '@angular/core';
import { prefersReducedMotion } from '@shared/utils/reduced-motion.util';
import type { FormTemplateSummary } from '../../data-access/client-forms.model';
import {
  DropdownMenuComponent,
  MenuItemDirective,
} from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';

@Component({
  selector: 'app-form-templates-list',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-left">
          <thead
            class="border-b border-gray-100 bg-gray-50/70 text-xs font-semibold uppercase tracking-wide text-gray-500"
          >
            <tr>
              <th class="px-5 py-3">Name</th>
              <th class="px-5 py-3">Purpose</th>
              <th class="px-5 py-3">Status</th>
              <th class="px-5 py-3">Version</th>
              <th class="px-5 py-3">Updated</th>
              <th class="px-5 py-3"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            @for (template of templates; track template.id) {
              <tr
                class="transition-colors hover:bg-gray-50/80"
                [class.row-published]="template.id === highlightId"
              >
                <td class="px-5 py-4">
                  <div class="flex items-center gap-3">
                    <span
                      class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-bold/[0.07] text-brand-bold"
                      aria-hidden="true"
                    >
                      <ion-icon name="document-text-outline" class="text-base"></ion-icon>
                    </span>
                    <div class="min-w-0">
                      <button
                        type="button"
                        class="font-semibold text-gray-900 transition-colors hover:text-brand-bold"
                        (click)="opened.emit(template.id)"
                      >
                        {{ template.name }}
                      </button>
                      <p class="mt-0.5 max-w-md truncate text-xs text-gray-500">
                        {{ template.description || 'No description' }}
                      </p>
                    </div>
                  </div>
                </td>
                <td class="px-5 py-4 text-sm text-gray-700">{{ label(template.purpose) }}</td>
                <td class="px-5 py-4">
                  <app-status-pill
                    [tone]="template.status === 'Active' ? 'success' : 'muted'"
                    [soft]="true"
                    size="xs"
                    >{{ template.status }}</app-status-pill
                  >
                </td>
                <td class="px-5 py-4 text-sm">
                  @if (template.latestVersionNumber) {
                    <span class="font-medium text-gray-700">v{{ template.latestVersionNumber }}</span>
                    @if (template.id === highlightId) {
                      <span class="live-tag ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Live</span>
                    }
                  } @else {
                    <span class="text-gray-400">Draft only</span>
                  }
                </td>
                <td class="px-5 py-4 text-sm text-gray-500">
                  {{ template.draftUpdatedAtUtc | date: 'mediumDate' }}
                </td>
                <td class="px-5 py-4 text-right">
                  <app-dropdown-menu [ariaLabel]="'Actions for ' + template.name">
                    <button appMenuItem type="button" (click)="opened.emit(template.id)">
                      <ion-icon name="create-outline"></ion-icon> Edit
                    </button>
                    <button appMenuItem type="button" (click)="duplicated.emit(template.id)">
                      <ion-icon name="copy-outline"></ion-icon> Duplicate
                    </button>
                    <button
                      appMenuItem
                      type="button"
                      [danger]="template.status === 'Active'"
                      (click)="statusChanged.emit(template)"
                    >
                      <ion-icon
                        [name]="
                          template.status === 'Active' ? 'archive-outline' : 'refresh-outline'
                        "
                      ></ion-icon>
                      {{ template.status === 'Active' ? 'Archive' : 'Restore' }}
                    </button>
                  </app-dropdown-menu>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="px-6 py-16 text-center">
                  <ion-icon name="documents-outline" class="text-4xl text-gray-300"></ion-icon>
                  <h3 class="mt-3 font-bold text-gray-900">No templates found</h3>
                  <p class="mt-1 text-sm text-gray-500">
                    Create a template to start collecting structured information.
                  </p>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  // Recién publicada: la fila destella al volver del builder y la etiqueta "Live" aparece con rebote.
  styles: `
    .row-published { animation: row-flash 2.6s cubic-bezier(0.2, 0, 0, 1); }
    .live-tag { display: inline-block; animation: live-pop 520ms 300ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
    @keyframes row-flash {
      0%, 35% { background-color: rgb(99 102 241 / 0.1); }
      100% { background-color: transparent; }
    }
    @keyframes live-pop {
      from { opacity: 0; transform: scale(0.6); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .row-published, .live-tag { animation: none; }
    }
  `,
  imports: [DatePipe, DropdownMenuComponent, MenuItemDirective, StatusPillComponent],
})
export class FormTemplatesListComponent implements AfterViewInit {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  @Input() templates: FormTemplateSummary[] = [];
  @Input() highlightId: string | null = null;
  ngAfterViewInit(): void {
    this.host.nativeElement
      .querySelector('.row-published')
      ?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
  @Output() readonly opened = new EventEmitter<string>();
  @Output() readonly duplicated = new EventEmitter<string>();
  @Output() readonly statusChanged = new EventEmitter<FormTemplateSummary>();
  label(value: string): string {
    return value.replace(/([A-Z])/g, ' $1').replace(/^./, (item) => item.toUpperCase());
  }
}
