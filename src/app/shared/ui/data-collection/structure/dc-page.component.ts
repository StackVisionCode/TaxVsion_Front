import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';
import type { FormDefinition, FormPage } from '@shared/utils/data-collection/form-definition.model';
import type { FormAnswers, RepeaterRows } from '@shared/utils/data-collection/form-answers.model';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';
import type { VisibilityMap } from '@shared/utils/data-collection/visibility';
import type {
  DataCollectionAttachment,
  DataCollectionConsentRequest,
  DataCollectionFileSelection,
  DataCollectionRendererMode,
  DataCollectionSensitiveEntry,
  DataCollectionValueChange,
} from '../data-collection.models';
import { styleClasses } from '../data-collection.utils';
import { DcMarkdownComponent } from '../rich-text/dc-markdown.component';
import { DcSectionComponent } from './dc-section.component';

@Component({
  selector: 'app-dc-page',
  imports: [NgClass, DcMarkdownComponent, DcSectionComponent],
  templateUrl: './dc-page.component.html',
})
export class DcPageComponent {
  @Input({ required: true }) page!: FormPage;
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
  get classes(): string[] {
    return styleClasses(this.page.style);
  }
}
