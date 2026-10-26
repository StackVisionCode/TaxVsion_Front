import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import { componentTypeLabel } from '../../utils/component-catalog';
import type { BuilderSelection } from '../../data-access/form-template-builder.store';

@Component({
  selector: 'app-builder-outline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Sin scroll propio: scrollea la columna del builder. -->
    <nav class="px-4 pb-5 pt-3" aria-label="Form outline">
      <ul class="space-y-2">
        @for (page of definition.pages; track page.id; let pageIndex = $index) {
          <li>
            <button
              type="button"
              class="w-full truncate rounded-full px-2 py-1.5 text-left text-xs font-bold text-gray-800 hover:bg-gray-100"
              [class.bg-brand-surface]="selection?.id === page.id"
              (click)="selected.emit({ kind: 'page', id: page.id })"
            >
              {{ page.title || 'Page ' + (pageIndex + 1) }}
            </button>
            <ul class="ml-3 mt-1 border-l border-gray-200 pl-2">
              @for (section of page.sections; track section.id; let sectionIndex = $index) {
                <li class="mt-1">
                  <button
                    type="button"
                    class="w-full truncate rounded-full px-2 py-1 text-left text-xs font-semibold text-gray-700 hover:bg-gray-100"
                    [class.bg-brand-surface]="selection?.id === section.id"
                    (click)="selected.emit({ kind: 'section', id: section.id })"
                  >
                    {{ section.title || 'Section ' + (sectionIndex + 1) }}
                  </button>
                  <ul class="ml-3 border-l border-gray-100 pl-2">
                    @for (field of section.components; track field.id) {
                      <li>
                        <button
                          type="button"
                          class="w-full truncate rounded-full px-2 py-1 text-left text-[11px] text-gray-600 hover:bg-gray-100"
                          [class.bg-brand-surface]="selection?.id === field.id"
                          (click)="selected.emit({ kind: 'component', id: field.id })"
                        >
                          {{ field.label || label(field.type) }}
                        </button>
                      </li>
                    }
                  </ul>
                </li>
              }
            </ul>
          </li>
        }
      </ul>
    </nav>
  `,
})
export class BuilderOutlineComponent {
  @Input({ required: true }) definition!: FormDefinition;
  @Input() selection: BuilderSelection = null;
  @Output() readonly selected = new EventEmitter<BuilderSelection>();

  label(value: string): string {
    return componentTypeLabel(value);
  }
}
