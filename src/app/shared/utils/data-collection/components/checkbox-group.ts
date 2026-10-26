import { componentType, OPERATORS } from './component-type';
export const CHECKBOX_GROUP_COMPONENT = componentType(
  'checkboxGroup',
  'input',
  'general',
  ['options', 'minSelected', 'maxSelected'],
  OPERATORS.multipleChoice,
);
