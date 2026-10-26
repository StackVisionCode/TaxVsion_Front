import { Component, Input, TemplateRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type {
  FormComponent,
  FormDefinition,
  FormSection,
} from '@shared/utils/data-collection/form-definition.model';
import { getComponentType } from '@shared/utils/data-collection/component-registry';
import { maskTaxId } from '@shared/utils/data-collection/formats';
import { isRecord } from '@shared/utils/data-collection/properties';
import { readRows, type VisibilityMap } from '@shared/utils/data-collection/visibility';
import type {
  DataCollectionAttachment,
  DataCollectionFieldComment,
} from '../data-collection.models';
import { optionsOf } from '../data-collection.utils';

interface AnswerEntry {
  component: FormComponent;
  rowId: string | null;
  rowLabel: string | null;
  value: unknown;
}

/**
 * Vista Review/solo lectura. `fieldActionsTemplate` permite que el contenedor proyecte Reveal u otras acciones.
 */
@Component({
  selector: 'app-dc-answers-view',
  imports: [NgTemplateOutlet],
  templateUrl: './dc-answers-view.component.html',
})
export class DcAnswersViewComponent {
  @Input({ required: true }) definition!: FormDefinition;
  @Input({ required: true }) answers!: FormAnswers;
  @Input({ required: true }) visibility!: VisibilityMap;
  @Input() attachments: Readonly<Record<string, DataCollectionAttachment>> = {};
  @Input() fieldComments: readonly DataCollectionFieldComment[] = [];
  @Input() fieldActionsTemplate: TemplateRef<{ $implicit: AnswerEntry }> | null = null;
  /** `staff`: la revisión de la oficina no usa el texto dirigido al cliente. */
  @Input() audience: 'participant' | 'staff' = 'participant';

  entries(): AnswerEntry[] {
    return this.definition.pages.flatMap((page) =>
      this.visibility.isVisible(page.id)
        ? page.sections.flatMap((section) => this.entriesForSection(section))
        : [],
    );
  }

  format(entry: AnswerEntry): string {
    const { component, value } = entry;
    if (value == null || value === '') return 'Not provided';
    if (component.type === 'yesNo' || component.type === 'checkbox')
      return value === true ? 'Yes' : 'No';
    if (component.type === 'select' || component.type === 'radio')
      return optionsOf(component).find((option) => option.value === value)?.label ?? String(value);
    if (component.type === 'checkboxGroup' && Array.isArray(value))
      return (
        value
          .map(
            (item) =>
              optionsOf(component).find((option) => option.value === item)?.label ?? String(item),
          )
          .join(', ') || 'Not provided'
      );
    if (component.type === 'address' && isRecord(value))
      return (
        ['line1', 'line2', 'city', 'state', 'postalCode']
          .map((key) => value[key])
          .filter((item): item is string => typeof item === 'string' && item.length > 0)
          .join(', ') || 'Not provided'
      );
    if (
      component.type === 'taxId' &&
      isRecord(value) &&
      typeof value['last4'] === 'string' &&
      (value['kind'] === 'ssn' || value['kind'] === 'itin' || value['kind'] === 'ein')
    )
      return maskTaxId(value['last4'], value['kind']);
    if (component.type === 'file' && Array.isArray(value))
      return (
        this.filesFor(entry)
          .map((item) => item.displayName)
          .join(', ') || `${value.length} file(s)`
      );
    return String(value);
  }

  commentsFor(entry: AnswerEntry): readonly DataCollectionFieldComment[] {
    return this.fieldComments.filter(
      (comment) =>
        comment.componentId === entry.component.id && (comment.rowId ?? null) === entry.rowId,
    );
  }

  private entriesForSection(section: FormSection): AnswerEntry[] {
    if (!this.visibility.isVisible(section.id)) return [];
    const inputs = section.components.filter(
      (component) => getComponentType(component.type)?.kind === 'input',
    );
    if (section.repeat == null)
      return inputs
        .filter((component) => this.visibility.isVisible(component.id))
        .map((component) => ({
          component,
          rowId: null,
          rowLabel: null,
          value: this.answers.values[component.id],
        }));
    return readRows(this.answers, section.id).flatMap((row, index) =>
      inputs
        .filter((component) => this.visibility.isRowVisible(component.id, row.rowId))
        .map((component) => ({
          component,
          rowId: row.rowId,
          rowLabel: `${section.repeat?.rowLabel ?? 'Row'} ${index + 1}`,
          value: row.values[component.id],
        })),
    );
  }

  private filesFor(entry: AnswerEntry): readonly DataCollectionAttachment[] {
    return Object.values(this.attachments).filter(
      (item) => item.componentId === entry.component.id && (item.rowId ?? null) === entry.rowId,
    );
  }
}
