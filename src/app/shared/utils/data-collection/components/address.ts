import { componentType, OPERATORS } from './component-type';
export const ADDRESS_COMPONENT = componentType(
  'address',
  'input',
  'personal',
  ['country'],
  OPERATORS.answered,
);
