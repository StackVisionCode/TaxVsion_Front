import { componentType, OPERATORS } from './component-type';
export const TEXTAREA_COMPONENT = componentType(
  'textarea',
  'input',
  'personal',
  ['maxLength', 'rows'],
  OPERATORS.answered,
);
