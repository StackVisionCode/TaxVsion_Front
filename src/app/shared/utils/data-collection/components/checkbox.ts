import { componentType, OPERATORS } from './component-type';
export const CHECKBOX_COMPONENT = componentType(
  'checkbox',
  'input',
  'general',
  ['text'],
  OPERATORS.checkbox,
);
