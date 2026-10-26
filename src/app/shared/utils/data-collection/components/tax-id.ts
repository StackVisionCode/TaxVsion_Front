import { componentType, OPERATORS } from './component-type';
export const TAX_ID_COMPONENT = componentType(
  'taxId',
  'input',
  'restricted',
  ['kinds'],
  OPERATORS.answered,
);
