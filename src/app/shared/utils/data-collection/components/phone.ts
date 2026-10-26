import { componentType, OPERATORS } from './component-type';
export const PHONE_COMPONENT = componentType(
  'phone',
  'input',
  'personal',
  ['defaultCountry'],
  OPERATORS.answered,
);
