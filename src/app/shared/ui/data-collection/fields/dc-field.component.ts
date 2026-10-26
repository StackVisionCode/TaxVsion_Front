import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';
import type { TaxIdentifierKind } from '@shared/utils/data-collection/formats';
import type {
  DataCollectionAttachment,
  DataCollectionRendererMode,
} from '../data-collection.models';
import { styleClasses } from '../data-collection.utils';
import { DcAddressFieldComponent } from './dc-address-field.component';
import { DcCalloutFieldComponent } from './dc-callout-field.component';
import { DcCheckboxFieldComponent } from './dc-checkbox-field.component';
import { DcCheckboxGroupFieldComponent } from './dc-checkbox-group-field.component';
import { DcConsentFieldComponent } from './dc-consent-field.component';
import { DcCurrencyFieldComponent } from './dc-currency-field.component';
import { DcDateFieldComponent } from './dc-date-field.component';
import { DcDividerFieldComponent } from './dc-divider-field.component';
import { DcEmailFieldComponent } from './dc-email-field.component';
import { DcFileFieldComponent } from './dc-file-field.component';
import { DcHeadingFieldComponent } from './dc-heading-field.component';
import { DcNumberFieldComponent } from './dc-number-field.component';
import { DcParagraphFieldComponent } from './dc-paragraph-field.component';
import { DcPhoneFieldComponent } from './dc-phone-field.component';
import { DcRadioFieldComponent } from './dc-radio-field.component';
import { DcSelectFieldComponent } from './dc-select-field.component';
import { DcSignatureStepFieldComponent } from './dc-signature-step-field.component';
import { DcSpacerFieldComponent } from './dc-spacer-field.component';
import { DcTaxIdFieldComponent } from './dc-tax-id-field.component';
import { DcTextFieldComponent } from './dc-text-field.component';
import { DcTextareaFieldComponent } from './dc-textarea-field.component';
import { DcUnsupportedFieldComponent } from './dc-unsupported-field.component';
import { DcYesNoFieldComponent } from './dc-yes-no-field.component';

/**
 * Dispatcher cerrado de los 22 tipos del schema v1. Uso interno de páginas y repeaters.
 */
@Component({
  selector: 'app-dc-field',
  imports: [
    NgClass,
    DcAddressFieldComponent,
    DcCalloutFieldComponent,
    DcCheckboxFieldComponent,
    DcCheckboxGroupFieldComponent,
    DcConsentFieldComponent,
    DcCurrencyFieldComponent,
    DcDateFieldComponent,
    DcDividerFieldComponent,
    DcEmailFieldComponent,
    DcFileFieldComponent,
    DcHeadingFieldComponent,
    DcNumberFieldComponent,
    DcParagraphFieldComponent,
    DcPhoneFieldComponent,
    DcRadioFieldComponent,
    DcSelectFieldComponent,
    DcSignatureStepFieldComponent,
    DcSpacerFieldComponent,
    DcTaxIdFieldComponent,
    DcTextFieldComponent,
    DcTextareaFieldComponent,
    DcUnsupportedFieldComponent,
    DcYesNoFieldComponent,
  ],
  templateUrl: './dc-field.component.html',
})
export class DcFieldComponent {
  @Input({ required: true }) component!: FormComponent;
  @Input() value: unknown = null;
  @Input() rowId: string | null = null;
  @Input() issues: readonly ValidationIssue[] = [];
  @Input() mode: DataCollectionRendererMode = 'fill';
  @Input() attachments: readonly DataCollectionAttachment[] = [];
  @Input() prefilled = false;
  @Input() required = false;
  @Output() readonly valueChange = new EventEmitter<unknown>();
  @Output() readonly fileSelected = new EventEmitter<File[]>();
  @Output() readonly fileRemoved = new EventEmitter<string>();
  @Output() readonly sensitiveEntered = new EventEmitter<{
    kind: TaxIdentifierKind;
    value: string;
  }>();
  @Output() readonly consentRequested = new EventEmitter<void>();

  get readonly(): boolean {
    return this.mode === 'readonly';
  }
  get classes(): string[] {
    return styleClasses(this.component.style);
  }
  get renderedComponent(): FormComponent {
    return this.component.required === this.required
      ? this.component
      : { ...this.component, required: this.required };
  }
}
