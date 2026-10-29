import { componentType, OPERATORS } from './component-type';
export const SELECT_COMPONENT = componentType(
  'select',
  'input',
  'general',
  ['options', 'placeholder'],
  OPERATORS.choice,
);
