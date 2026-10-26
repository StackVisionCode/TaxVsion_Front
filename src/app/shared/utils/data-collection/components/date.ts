import { componentType, OPERATORS } from './component-type';
export const DATE_COMPONENT = componentType(
  'date',
  'input',
  'personal',
  ['min', 'max'],
  OPERATORS.ordered,
);
