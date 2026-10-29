import { componentType, OPERATORS } from './component-type';
export const CURRENCY_COMPONENT = componentType(
  'currency',
  'input',
  'financial',
  ['currency', 'min', 'max', 'allowNegative'],
  OPERATORS.ordered,
);
