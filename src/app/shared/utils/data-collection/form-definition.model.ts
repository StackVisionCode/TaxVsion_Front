import type { Condition } from './conditions';
import type { RichTextDocument } from './rich-text';

export type FormPurpose =
  | 'general'
  | 'clientIntake'
  | 'questionnaire'
  | 'checklist'
  | 'informationRequest'
  | 'documentRequest'
  | 'assessment';

export type FormPresentation = 'singlePage' | 'wizard';
export type FormCollectionBasis = 'serviceRequest' | 'consent';
export type DataClass = 'general' | 'financial' | 'personal' | 'restricted';
export type MappingTransform = 'none' | 'trim' | 'lowercase' | 'uppercase' | 'digitsOnly';
export type FormActionType =
  | 'notifyStaff'
  | 'routeToReview'
  | 'generateSummary'
  | 'createCustomer'
  | 'updateCustomerProfile'
  | 'requestSignature'
  | 'applyRetentionClass';
export type FormActionTrigger = 'onSubmit' | 'onComplete' | 'manual';

export interface FormDefinition {
  schemaVersion: number;
  title: string;
  description?: RichTextDocument | null;
  purpose: FormPurpose;
  presentation: FormPresentation;
  settings?: FormSettings;
  pages: FormPage[];
  mappings?: FormMapping[];
  actions?: FormAction[];
}

export interface FormSettings {
  showProgress?: boolean;
  collectionBasis?: FormCollectionBasis;
}

export interface FormPage {
  id: string;
  title?: string | null;
  description?: RichTextDocument | null;
  visibleWhen?: Condition | null;
  style?: FormStyle | null;
  sections: FormSection[];
}

export interface FormSection {
  id: string;
  title?: string | null;
  description?: RichTextDocument | null;
  visibleWhen?: Condition | null;
  repeat?: FormRepeat | null;
  style?: FormStyle | null;
  components: FormComponent[];
}

export interface FormRepeat {
  minRows: number;
  maxRows: number;
  addLabel: string;
  rowLabel: string;
}

export interface FormComponent {
  id: string;
  type: string;
  key?: string | null;
  label?: string | null;
  help?: RichTextDocument | null;
  required?: boolean;
  requiredWhen?: Condition | null;
  visibleWhen?: Condition | null;
  dataClass?: DataClass | null;
  reportable?: boolean;
  prefill?: FormPrefill | null;
  style?: FormStyle | null;
  props?: Record<string, unknown>;
}

export interface FormPrefill {
  source: string;
}

export interface FormMapping {
  componentId: string;
  targetKey: string;
  transform?: MappingTransform;
  optionMap?: Record<string, string> | null;
  rowFields?: Record<string, string> | null;
}

export interface FormAction {
  key: string;
  type: FormActionType;
  trigger: FormActionTrigger;
  condition?: Condition | null;
  config?: Record<string, unknown>;
}

export interface FormStyle {
  width?: string | null;
  align?: string | null;
  textSize?: string | null;
  textColor?: string | null;
  background?: string | null;
  spacingTop?: number | null;
  spacingBottom?: number | null;
}
