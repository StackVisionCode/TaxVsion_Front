import { Directive, EventEmitter, Input, Output } from '@angular/core';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';
import { fieldDomId, fieldErrorId, fieldHelpId } from '../data-collection.utils';

@Directive()
export abstract class DcFieldBase<T = unknown> {
  @Input({ required: true }) component!: FormComponent;
  @Input() value: T | null = null;
  @Input() rowId: string | null = null;
  @Input() issues: readonly ValidationIssue[] = [];
  @Input() readonly = false;
  @Input() prefilled = false;
  @Input() required = false;
  @Output() readonly valueChange = new EventEmitter<T>();

  get inputId(): string {
    return fieldDomId(this.component.id, this.rowId);
  }

  get helpId(): string {
    return fieldHelpId(this.component.id, this.rowId);
  }

  get errorId(): string {
    return fieldErrorId(this.component.id, this.rowId);
  }

  get describedBy(): string | null {
    const ids = [
      this.component.help ? this.helpId : '',
      this.errorMessage ? this.errorId : '',
    ].filter(Boolean);
    return ids.length > 0 ? ids.join(' ') : null;
  }

  get errorMessage(): string | null {
    return this.issues[0]?.message ?? null;
  }

  emitValue(value: T): void {
    if (!this.readonly) this.valueChange.emit(value);
  }
}
