import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import type {
  FormComponent,
  FormDefinition,
  FormSection,
} from '@shared/utils/data-collection/form-definition.model';
import type { RepeaterRow, RepeaterRows } from '@shared/utils/data-collection/form-answers.model';
import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';
import type { VisibilityMap } from '@shared/utils/data-collection/visibility';
import type {
  DataCollectionAttachment,
  DataCollectionConsentRequest,
  DataCollectionFileSelection,
  DataCollectionRendererMode,
  DataCollectionSensitiveEntry,
} from '../data-collection.models';
import { createRowId, isComponentRequired } from '../data-collection.utils';
import { DcFieldComponent } from '../fields/dc-field.component';

/** Repeater accesible con IDs criptográficos, confirmación y foco predecible. */
@Component({
  selector: 'app-dc-repeater',
  imports: [DcFieldComponent, ConfirmDialogComponent],
  templateUrl: './dc-repeater.component.html',
})
export class DcRepeaterComponent {
  @Input({ required: true }) section!: FormSection;
  @Input({ required: true }) definition!: FormDefinition;
  @Input({ required: true }) answers!: FormAnswers;
  @Input({ required: true }) rows: readonly RepeaterRow[] = [];
  @Input({ required: true }) visibility!: VisibilityMap;
  @Input() mode: DataCollectionRendererMode = 'fill';
  @Input() issues: readonly ValidationIssue[] = [];
  @Input() attachments: Readonly<Record<string, DataCollectionAttachment>> = {};
  @Input() prefilledIds: readonly string[] = [];
  @Output() readonly rowsChange = new EventEmitter<RepeaterRows>();
  @Output() readonly fileSelected = new EventEmitter<DataCollectionFileSelection>();
  @Output() readonly fileRemoved = new EventEmitter<string>();
  @Output() readonly sensitiveEntered = new EventEmitter<DataCollectionSensitiveEntry>();
  @Output() readonly consentRequested = new EventEmitter<DataCollectionConsentRequest>();
  @ViewChild('addButton') private addButton?: ElementRef<HTMLButtonElement>;

  announcement = '';
  pendingRemoval: { rowId: string; index: number } | null = null;

  get readonly(): boolean {
    return this.mode === 'readonly';
  }
  get canAdd(): boolean {
    return !this.readonly && this.rows.length < (this.section.repeat?.maxRows ?? 0);
  }

  addRow(): void {
    if (!this.canAdd) return;
    const row: RepeaterRow = { rowId: createRowId(), values: {} };
    this.rowsChange.emit({ rows: [...this.rows, row] });
    this.announcement = `${this.section.repeat?.rowLabel ?? 'Row'} ${this.rows.length + 1} added.`;
    setTimeout(() =>
      document
        .querySelector<HTMLElement>(
          `[data-dc-row-id="${row.rowId}"] input, [data-dc-row-id="${row.rowId}"] select, [data-dc-row-id="${row.rowId}"] textarea, [data-dc-row-id="${row.rowId}"] button`,
        )
        ?.focus(),
    );
  }

  requestRemove(rowId: string, index: number): void {
    this.pendingRemoval = { rowId, index };
  }

  cancelRemove(): void {
    this.pendingRemoval = null;
  }

  confirmRemove(): void {
    const pending = this.pendingRemoval;
    if (pending == null) return;
    this.rowsChange.emit({ rows: this.rows.filter((row) => row.rowId !== pending.rowId) });
    this.announcement = `${this.section.repeat?.rowLabel ?? 'Row'} ${pending.index + 1} removed.`;
    this.pendingRemoval = null;
    setTimeout(() => {
      const previous = pending.index > 0 ? this.rows[pending.index - 1] : null;
      if (previous)
        document
          .querySelector<HTMLElement>(
            `[data-dc-row-id="${previous.rowId}"] input, [data-dc-row-id="${previous.rowId}"] button`,
          )
          ?.focus();
      else this.addButton?.nativeElement.focus();
    });
  }

  updateRow(rowId: string, componentId: string, value: unknown): void {
    this.rowsChange.emit({
      rows: this.rows.map((row) =>
        row.rowId === rowId ? { ...row, values: { ...row.values, [componentId]: value } } : row,
      ),
    });
  }

  componentIssues(componentId: string, rowId: string): readonly ValidationIssue[] {
    return this.issues.filter(
      (issue) => issue.componentId === componentId && issue.rowId === rowId,
    );
  }

  componentAttachments(componentId: string, rowId: string): readonly DataCollectionAttachment[] {
    return Object.values(this.attachments).filter(
      (item) => item.componentId === componentId && item.rowId === rowId,
    );
  }

  required(component: FormComponent, row: RepeaterRow): boolean {
    return isComponentRequired(
      component,
      this.definition,
      this.answers,
      this.visibility,
      row.rowId,
      row.values,
    );
  }
}
