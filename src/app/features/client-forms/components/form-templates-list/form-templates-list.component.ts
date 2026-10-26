import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import type { FormTemplateSummary } from '../../data-access/client-forms.model';
import {
  DropdownMenuComponent,
  MenuItemDirective,
} from '@shared/ui/dropdown-menu/dropdown-menu.component';

@Component({
  selector: 'app-form-templates-list',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-left">
          <thead
            class="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase text-gray-600"
          >
            <tr>
              <th class="px-5 py-3">Name</th>
              <th class="px-4 py-3">Purpose</th>
              <th class="px-4 py-3">Status</th>
              <th class="px-4 py-3">Version</th>
              <th class="px-4 py-3">Updated</th>
              <th class="px-4 py-3"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            @for (template of templates; track template.id) {
              <tr class="hover:bg-gray-50">
                <td class="px-5 py-4">
                  <button
                    type="button"
                    class="font-semibold text-brand-bold hover:underline"
                    (click)="opened.emit(template.id)"
                  >
                    {{ template.name }}
                  </button>
                  <p class="mt-1 max-w-md truncate text-xs text-gray-500">
                    {{ template.description || 'No description' }}
                  </p>
                </td>
                <td class="px-4 py-4 text-sm text-gray-700">{{ label(template.purpose) }}</td>
                <td class="px-4 py-4">
                  <span
                    class="rounded-full px-2 py-1 text-xs font-semibold"
                    [class.bg-emerald-50]="template.status === 'Active'"
                    [class.text-emerald-700]="template.status === 'Active'"
                    [class.bg-gray-100]="template.status === 'Archived'"
                    >{{ template.status }}</span
                  >
                </td>
                <td class="px-4 py-4 text-sm text-gray-700">
                  {{
                    template.latestVersionNumber ? 'v' + template.latestVersionNumber : 'Draft only'
                  }}
                </td>
                <td class="px-4 py-4 text-sm text-gray-600">
                  {{ template.draftUpdatedAtUtc | date: 'mediumDate' }}
                </td>
                <td class="px-4 py-4">
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
  imports: [DatePipe, DropdownMenuComponent, MenuItemDirective],
})
export class FormTemplatesListComponent {
  @Input() templates: FormTemplateSummary[] = [];
  @Output() readonly opened = new EventEmitter<string>();
  @Output() readonly duplicated = new EventEmitter<string>();
  @Output() readonly statusChanged = new EventEmitter<FormTemplateSummary>();
  label(value: string): string {
    return value.replace(/([A-Z])/g, ' $1').replace(/^./, (item) => item.toUpperCase());
  }
}
