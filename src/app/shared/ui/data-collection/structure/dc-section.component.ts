import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';
import type {
  FormComponent,
  FormDefinition,
  FormSection,
} from '@shared/utils/data-collection/form-definition.model';
import type { FormAnswers, RepeaterRows } from '@shared/utils/data-collection/form-answers.model';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';
import { readRows, type VisibilityMap } from '@shared/utils/data-collection/visibility';
import type {
  DataCollectionAttachment,
  DataCollectionConsentRequest,
  DataCollectionFileSelection,
  DataCollectionRendererMode,
  DataCollectionSensitiveEntry,
  DataCollectionValueChange,
} from '../data-collection.models';
import { isComponentRequired, styleClasses } from '../data-collection.utils';
import { DcMarkdownComponent } from '../rich-text/dc-markdown.component';
import { DcFieldComponent } from '../fields/dc-field.component';
import { DcRepeaterComponent } from './dc-repeater.component';

@Component({
  selector: 'app-dc-section',
  imports: [NgClass, DcMarkdownComponent, DcFieldComponent, DcRepeaterComponent],
  templateUrl: './dc-section.component.html',
})
export class DcSectionComponent {
  @Input({ required: true }) section!: FormSection;
  @Input({ required: true }) definition!: FormDefinition;
  @Input({ required: true }) answers!: FormAnswers;
  @Input({ required: true }) visibility!: VisibilityMap;
  @Input() mode: DataCollectionRendererMode = 'fill';
  @Input() issues: readonly ValidationIssue[] = [];
  @Input() attachments: Readonly<Record<string, DataCollectionAttachment>> = {};
  @Input() prefilledIds: readonly string[] = [];
  @Output() readonly valueChange = new EventEmitter<DataCollectionValueChange>();
  @Output() readonly repeaterChange = new EventEmitter<{
    sectionId: string;
    value: RepeaterRows;
  }>();
  @Output() readonly fileSelected = new EventEmitter<DataCollectionFileSelection>();
  @Output() readonly fileRemoved = new EventEmitter<string>();
  @Output() readonly sensitiveEntered = new EventEmitter<DataCollectionSensitiveEntry>();
  @Output() readonly consentRequested = new EventEmitter<DataCollectionConsentRequest>();

  get rows() {
    return readRows(this.answers, this.section.id);
  }
  get classes(): string[] {
    return styleClasses(this.section.style);
  }
  componentIssues(id: string): readonly ValidationIssue[] {
    return this.issues.filter((issue) => issue.componentId === id && issue.rowId == null);
  }
  componentAttachments(id: string): readonly DataCollectionAttachment[] {
    return Object.values(this.attachments).filter(
      (item) => item.componentId === id && item.rowId == null,
    );
  }
  required(component: FormComponent): boolean {
    return isComponentRequired(component, this.definition, this.answers, this.visibility);
  }
}
