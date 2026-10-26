import { componentType, OPERATORS } from './component-type';
export const FILE_COMPONENT = componentType(
  'file',
  'input',
  'personal',
  ['maxFiles', 'allowedTypes', 'maxFileBytes', 'instructions'],
  OPERATORS.answered,
);
