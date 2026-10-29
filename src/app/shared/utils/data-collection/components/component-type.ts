import type { DataClass } from '../form-definition.model';

export type ComponentKind = 'layout' | 'compliance' | 'input';

export interface ComponentType {
  name: string;
  kind: ComponentKind;
  minimumDataClass: DataClass | null;
  allowedProperties: ReadonlySet<string>;
  allowedOperators: ReadonlySet<string>;
}

export const OPERATORS = {
  answered: ['isAnswered', 'isNotAnswered'],
  equality: ['isAnswered', 'isNotAnswered', 'equals', 'notEquals'],
  ordered: ['isAnswered', 'isNotAnswered', 'equals', 'notEquals', 'gt', 'gte', 'lt', 'lte'],
  choice: ['isAnswered', 'isNotAnswered', 'equals', 'notEquals', 'in', 'notIn'],
  boolean: ['isTrue', 'isFalse', 'isAnswered', 'isNotAnswered'],
  checkbox: ['isTrue', 'isFalse'],
  multipleChoice: ['isAnswered', 'isNotAnswered', 'contains', 'notContains'],
} as const;

export function componentType(
  name: string,
  kind: ComponentKind,
  minimumDataClass: DataClass | null,
  properties: readonly string[] = [],
  operators: readonly string[] = [],
): ComponentType {
  return {
    name,
    kind,
    minimumDataClass,
    allowedProperties: new Set(properties),
    allowedOperators: new Set(operators),
  };
}
