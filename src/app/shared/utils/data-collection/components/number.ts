import { componentType, OPERATORS } from './component-type';
export const NUMBER_COMPONENT = componentType(
  'number',
  'input',
  'financial',
  ['min', 'max', 'decimals', 'unitLabel'],
  OPERATORS.ordered,
);
