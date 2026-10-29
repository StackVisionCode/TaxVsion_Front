import { ADDRESS_COMPONENT } from './components/address';
import { CALLOUT_COMPONENT } from './components/callout';
import { CHECKBOX_COMPONENT } from './components/checkbox';
import { CHECKBOX_GROUP_COMPONENT } from './components/checkbox-group';
import type { ComponentType } from './components/component-type';
import { CONSENT_COMPONENT } from './components/consent';
import { CURRENCY_COMPONENT } from './components/currency';
import { DATE_COMPONENT } from './components/date';
import { DIVIDER_COMPONENT } from './components/divider';
import { EMAIL_COMPONENT } from './components/email';
import { FILE_COMPONENT } from './components/file';
import { HEADING_COMPONENT } from './components/heading';
import { NUMBER_COMPONENT } from './components/number';
import { PARAGRAPH_COMPONENT } from './components/paragraph';
import { PHONE_COMPONENT } from './components/phone';
import { RADIO_COMPONENT } from './components/radio';
import { SELECT_COMPONENT } from './components/select';
import { SIGNATURE_STEP_COMPONENT } from './components/signature-step';
import { SPACER_COMPONENT } from './components/spacer';
import { TAX_ID_COMPONENT } from './components/tax-id';
import { TEXT_COMPONENT } from './components/text';
import { TEXTAREA_COMPONENT } from './components/textarea';
import { YES_NO_COMPONENT } from './components/yes-no';

const TYPES: readonly ComponentType[] = [
  HEADING_COMPONENT,
  PARAGRAPH_COMPONENT,
  CALLOUT_COMPONENT,
  DIVIDER_COMPONENT,
  SPACER_COMPONENT,
  CONSENT_COMPONENT,
  SIGNATURE_STEP_COMPONENT,
  TEXT_COMPONENT,
  TEXTAREA_COMPONENT,
  NUMBER_COMPONENT,
  CURRENCY_COMPONENT,
  DATE_COMPONENT,
  EMAIL_COMPONENT,
  PHONE_COMPONENT,
  SELECT_COMPONENT,
  RADIO_COMPONENT,
  CHECKBOX_GROUP_COMPONENT,
  YES_NO_COMPONENT,
  CHECKBOX_COMPONENT,
  FILE_COMPONENT,
  ADDRESS_COMPONENT,
  TAX_ID_COMPONENT,
];

const TYPES_BY_NAME = new Map(TYPES.map((type) => [type.name, type]));

export function getComponentType(name: string): ComponentType | undefined {
  return TYPES_BY_NAME.get(name);
}

export function componentTypes(): readonly ComponentType[] {
  return TYPES;
}
