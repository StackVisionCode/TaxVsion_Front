import { componentType, OPERATORS } from './component-type';
export const YES_NO_COMPONENT = componentType(
  'yesNo',
  'input',
  'general',
  ['yesLabel', 'noLabel'],
  OPERATORS.boolean,
);
