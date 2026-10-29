import { componentType, OPERATORS } from './component-type';
export const TEXT_COMPONENT = componentType(
  'text',
  'input',
  'personal',
  ['maxLength', 'minLength', 'autocomplete'],
  OPERATORS.equality,
);
