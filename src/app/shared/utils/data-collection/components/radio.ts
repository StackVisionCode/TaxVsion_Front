import { componentType, OPERATORS } from './component-type';
export const RADIO_COMPONENT = componentType(
  'radio',
  'input',
  'general',
  ['options', 'layout'],
  OPERATORS.choice,
);
