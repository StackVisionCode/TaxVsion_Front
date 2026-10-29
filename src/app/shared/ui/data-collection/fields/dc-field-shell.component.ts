import { Component, Input } from '@angular/core';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';
import { DcMarkdownComponent } from '../rich-text/dc-markdown.component';
import { fieldErrorId, fieldHelpId } from '../data-collection.utils';

/**
 * Marco accesible de un campo. Uso interno del renderer; proyecta el control nativo.
 */
@Component({
  selector: 'app-dc-field-shell',
  imports: [DcMarkdownComponent],
  template: `
    <div class="space-y-2">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <label [for]="inputId" class="text-sm font-semibold text-gray-900">
          {{ component.label || 'Untitled field' }}
          @if (component.required) {
            <span class="text-red-600" aria-hidden="true">*</span>
          }
        </label>
        @if (prefilled) {
          <span class="text-xs font-medium text-brand-bold">Prefilled</span>
        }
      </div>
      @if (component.help) {
        <div [id]="helpId" class="text-sm text-gray-600">
          <app-dc-markdown [document]="component.help" />
        </div>
      }
      <ng-content />
      @if (errorMessage) {
        <p [id]="errorId" class="text-sm font-medium text-red-700">{{ errorMessage }}</p>
      }
    </div>
  `,
})
export class DcFieldShellComponent {
  @Input({ required: true }) component!: FormComponent;
  @Input({ required: true }) inputId = '';
  @Input() rowId: string | null = null;
  @Input() issues: readonly ValidationIssue[] = [];
  @Input() prefilled = false;
  @Input() required = false;

  get helpId(): string {
    return fieldHelpId(this.component.id, this.rowId);
  }
  get errorId(): string {
    return fieldErrorId(this.component.id, this.rowId);
  }
  get errorMessage(): string | null {
    return this.issues[0]?.message ?? null;
  }
}
