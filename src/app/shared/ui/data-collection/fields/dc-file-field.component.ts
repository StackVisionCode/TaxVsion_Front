import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DropzoneComponent } from '@shared/ui/dropzone/dropzone.component';
import { intProp, stringProp } from '@shared/utils/data-collection/properties';
import type { DataCollectionAttachment } from '../data-collection.models';
import { DcFieldBase } from './dc-field-base';
import { DcFieldShellComponent } from './dc-field-shell.component';

@Component({
  selector: 'app-dc-file-field',
  imports: [DcFieldShellComponent, DropzoneComponent],
  host: { '[attr.id]': 'inputId', tabindex: '-1' },
  template: `<app-dc-field-shell
    [component]="component"
    [inputId]="inputId"
    [rowId]="rowId"
    [issues]="issues"
    [prefilled]="prefilled"
    [required]="component.required === true"
  >
    @if (!readonly) {
      <app-dropzone
        [accept]="accept"
        [multiple]="maxFiles > 1"
        [maxBytes]="maxBytes"
        [disabled]="readonly"
        label="Add supporting files"
        [hint]="instructions"
        [inputLabel]="uploadLabel"
        (files)="selected.emit($event)"
      />
    }
    @if (attachments.length > 0) {
      <ul class="mt-3 space-y-2" aria-label="Attached files" aria-live="polite">
        @for (attachment of attachments; track attachment.id) {
          <li
            class="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-gray-900">{{ attachment.displayName }}</p>
              @if (attachment.status) {
                <p class="text-xs text-gray-600">{{ attachment.status }}</p>
              }
            </div>
            @if (!readonly) {
              <button
                type="button"
                class="min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                [attr.aria-label]="'Remove ' + attachment.displayName"
                (click)="removed.emit(attachment.id)"
              >
                Remove
              </button>
            }
          </li>
        }
      </ul>
    }
  </app-dc-field-shell>`,
})
export class DcFileFieldComponent extends DcFieldBase<unknown[]> {
  @Input() attachments: readonly DataCollectionAttachment[] = [];
  @Output() readonly selected = new EventEmitter<File[]>();
  @Output() readonly removed = new EventEmitter<string>();
  get maxFiles(): number {
    return intProp(this.component.props, 'maxFiles', 5);
  }
  get maxBytes(): number {
    return intProp(this.component.props, 'maxFileBytes', 10 * 1024 * 1024);
  }
  get accept(): string {
    const types = this.component.props?.['allowedTypes'];
    return Array.isArray(types)
      ? types.filter((value): value is string => typeof value === 'string').join(',')
      : '';
  }
  /** Nombre del selector de archivos para lectores: el label de la página no lo alcanza. */
  get uploadLabel(): string {
    const label = this.component.label || 'this question';
    return `Browse files for ${label}${this.component.required ? ' (required)' : ''}`;
  }
  get instructions(): string {
    return stringProp(this.component.props, 'instructions') ?? `Up to ${this.maxFiles} files`;
  }
}
