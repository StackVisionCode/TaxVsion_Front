import type { DataCollectionLimits } from './data-collection-limits';
import type { DefinitionIndex } from './definition-index';
import type { FormAnswers } from './form-answers.model';
import type { FormComponent } from './form-definition.model';
import { isValidIsoDate } from './formats';
import { compareOrdinal, optionValues } from './properties';
import { issue, type ValidationIssue } from './validation';
import type { VisibilityMap } from './visibility';

export interface Condition {
  all?: Condition[] | null;
  any?: Condition[] | null;
  not?: Condition | null;
  field?: string | null;
  rows?: string | null;
  op?: string | null;
  value?: unknown;
}

export function validateCondition(
  condition: Condition | null | undefined,
  path: string,
  currentOrder: number,
  currentRepeater: string | null,
  index: DefinitionIndex,
  limits: DataCollectionLimits,
  issues: ValidationIssue[],
): void {
  if (condition == null) return;
  let nodes = 0;

  const visit = (node: Condition, nodePath: string, depth: number): void => {
    nodes++;
    if (nodes > limits.maxConditionNodes) {
      issues.push(issue('condition.too_many_nodes', nodePath));
      return;
    }
    if (depth > limits.maxConditionDepth) {
      issues.push(issue('condition.too_deep', nodePath));
      return;
    }
    const shapes =
      Number(node.all != null) +
      Number(node.any != null) +
      Number(node.not != null) +
      Number(node.field != null) +
      Number(node.rows != null);
    if (shapes !== 1) {
      issues.push(issue('condition.value_invalid', nodePath));
      return;
    }
    if (node.all != null || node.any != null) {
      if (node.op != null || Object.prototype.hasOwnProperty.call(node, 'value')) {
        issues.push(issue('condition.value_invalid', nodePath));
        return;
      }
      const children = node.all ?? node.any ?? [];
      if (!Array.isArray(children) || children.length < 1 || children.length > 10)
        issues.push(issue('condition.value_invalid', nodePath));
      children.forEach((child, childIndex) =>
        visit(child, `${nodePath}/${node.all == null ? 'any' : 'all'}/${childIndex}`, depth + 1),
      );
      return;
    }
    if (node.not != null) {
      if (node.op != null || Object.prototype.hasOwnProperty.call(node, 'value')) {
        issues.push(issue('condition.value_invalid', nodePath));
        return;
      }
      visit(node.not, `${nodePath}/not`, depth + 1);
      return;
    }
    if (node.rows != null) {
      const target = index.sections.get(node.rows);
      if (target == null || target.section.repeat == null) {
        issues.push(issue('condition.unknown_field', `${nodePath}/rows`));
        return;
      }
      if (target.order >= currentOrder)
        issues.push(issue('condition.forward_reference', `${nodePath}/rows`));
      if (!['countGte', 'countLte', 'countEquals'].includes(node.op ?? ''))
        issues.push(issue('condition.op_not_allowed', `${nodePath}/op`));
      if (
        !Number.isInteger(node.value) ||
        Number(node.value) < 0 ||
        Number(node.value) > limits.maxRepeaterRows
      )
        issues.push(issue('condition.value_invalid', `${nodePath}/value`));
      return;
    }
    const target = node.field == null ? undefined : index.components.get(node.field);
    if (target?.componentType?.kind !== 'input') {
      issues.push(issue('condition.unknown_field', `${nodePath}/field`));
      return;
    }
    if (target.order >= currentOrder)
      issues.push(issue('condition.forward_reference', `${nodePath}/field`));
    if (target.repeaterSectionId != null && target.repeaterSectionId !== currentRepeater)
      issues.push(issue('condition.out_of_scope', `${nodePath}/field`));
    const allowed = node.op != null && target.componentType.allowedOperators.has(node.op);
    if (!allowed) issues.push(issue('condition.op_not_allowed', `${nodePath}/op`));
    validateConditionValue(node, target.component, allowed, nodePath, issues);
  };
  visit(condition, path, 1);
}

function validateConditionValue(
  node: Condition,
  target: FormComponent,
  operatorAllowed: boolean,
  path: string,
  issues: ValidationIssue[],
): void {
  const noValue = ['isAnswered', 'isNotAnswered', 'isTrue', 'isFalse'].includes(node.op ?? '');
  const hasValue = Object.prototype.hasOwnProperty.call(node, 'value') && node.value != null;
  if (noValue) {
    if (hasValue) issues.push(issue('condition.value_invalid', `${path}/value`));
    return;
  }
  if (!hasValue) {
    issues.push(issue('condition.value_invalid', `${path}/value`));
    return;
  }
  if (node.op === 'in' || node.op === 'notIn') {
    if (!Array.isArray(node.value) || node.value.length < 1 || node.value.length > 50) {
      issues.push(issue('condition.value_invalid', `${path}/value`));
      return;
    }
  }
  if (!operatorAllowed) return;
  const options = optionValues(target.props);
  let valid: boolean;
  if (node.op === 'in' || node.op === 'notIn')
    valid = (node.value as unknown[]).every(
      (value) => typeof value === 'string' && options.has(value),
    );
  else if (node.op === 'contains' || node.op === 'notContains')
    valid = typeof node.value === 'string' && options.has(node.value);
  else if (target.type === 'number' || target.type === 'currency')
    valid = typeof node.value === 'number' && Number.isFinite(node.value);
  else if (target.type === 'date') valid = isValidIsoDate(node.value);
  else if (target.type === 'yesNo' || target.type === 'checkbox')
    valid = typeof node.value === 'boolean';
  else valid = typeof node.value === 'string';
  if (!valid) issues.push(issue('condition.value_invalid', `${path}/value`));
}

export function evaluateCondition(
  condition: Condition | null | undefined,
  answers: FormAnswers,
  index: DefinitionIndex,
  visibility: VisibilityMap,
  rowId: string | null = null,
  rowValues: Record<string, unknown> | null = null,
): boolean {
  if (condition == null) return true;
  if (condition.all != null)
    return condition.all.every((child) =>
      evaluateCondition(child, answers, index, visibility, rowId, rowValues),
    );
  if (condition.any != null)
    return condition.any.some((child) =>
      evaluateCondition(child, answers, index, visibility, rowId, rowValues),
    );
  if (condition.not != null)
    return !evaluateCondition(condition.not, answers, index, visibility, rowId, rowValues);
  if (condition.rows != null) {
    const count = visibility.rowCount(condition.rows, answers);
    if (!Number.isInteger(condition.value)) return false;
    if (condition.op === 'countGte') return count >= Number(condition.value);
    if (condition.op === 'countLte') return count <= Number(condition.value);
    return condition.op === 'countEquals' && count === Number(condition.value);
  }
  const target = condition.field == null ? undefined : index.components.get(condition.field);
  if (target == null) return false;
  const visible =
    target.repeaterSectionId == null
      ? visibility.isVisible(target.component.id)
      : rowId != null && visibility.isRowVisible(target.component.id, rowId);
  const value = visible
    ? target.repeaterSectionId == null
      ? answers.values[target.component.id]
      : rowValues?.[target.component.id]
    : undefined;
  const answered = isAnswered(value, target.component.type);
  switch (condition.op) {
    case 'isAnswered':
      return answered;
    case 'isNotAnswered':
      return !answered;
    case 'isTrue':
      return answered && value === true;
    case 'isFalse':
      return answered && value === false;
  }
  if (!answered) return false;
  const compared = compare(value, condition.value, target.component.type);
  switch (condition.op) {
    case 'equals':
      return compared === 0;
    case 'notEquals':
      return compared != null && compared !== 0;
    case 'gt':
      return compared != null && compared > 0;
    case 'gte':
      return compared != null && compared >= 0;
    case 'lt':
      return compared != null && compared < 0;
    case 'lte':
      return compared != null && compared <= 0;
    case 'in':
      return (
        Array.isArray(condition.value) &&
        condition.value.some((candidate) => compare(value, candidate, target.component.type) === 0)
      );
    case 'notIn':
      return (
        Array.isArray(condition.value) &&
        condition.value.every((candidate) => {
          const result = compare(value, candidate, target.component.type);
          return result != null && result !== 0;
        })
      );
    case 'contains':
      return contains(value, condition.value) === true;
    case 'notContains':
      return contains(value, condition.value) === false;
    default:
      return false;
  }
}

export function isAnswered(value: unknown, componentType: string): boolean {
  if (value == null) return false;
  if (
    [
      'text',
      'textarea',
      'number',
      'currency',
      'date',
      'email',
      'phone',
      'select',
      'radio',
    ].includes(componentType)
  )
    return typeof value === 'string' && value.trim().length > 0;
  if (componentType === 'checkboxGroup' || componentType === 'file')
    return Array.isArray(value) && value.length > 0;
  if (componentType === 'yesNo' || componentType === 'checkbox') return typeof value === 'boolean';
  if (componentType === 'address' || componentType === 'taxId') return isRecord(value);
  return false;
}

function compare(left: unknown, right: unknown, type: string): number | null {
  if (type === 'number' || type === 'currency') {
    if (
      typeof left !== 'string' ||
      typeof right !== 'number' ||
      !Number.isFinite(right) ||
      !/^-?[0-9]+(\.[0-9]+)?$/.test(left)
    )
      return null;
    const number = Number(left);
    return Number.isFinite(number) ? Math.sign(number - right) : null;
  }
  // Fecha ISO, texto y email se comparan como .NET: ordinal, sin cultura ni normalización Unicode.
  if (type === 'date')
    return isValidIsoDate(left) && isValidIsoDate(right) ? compareOrdinal(left, right) : null;
  if (typeof left === 'string' && typeof right === 'string')
    return type === 'email'
      ? compareOrdinal(upperInvariant(left), upperInvariant(right))
      : compareOrdinal(left, right);
  if (typeof left === 'boolean' && typeof right === 'boolean') return left === right ? 0 : 1;
  return null;
}

// OrdinalIgnoreCase: mayúscula simple por carácter (sin expandir "ß" a "SS").
function upperInvariant(value: string): string {
  return Array.from(value, (character) => {
    const upper = character.toUpperCase();
    return upper.length === character.length ? upper : character;
  }).join('');
}

function contains(value: unknown, expected: unknown): boolean | null {
  if (
    !Array.isArray(value) ||
    typeof expected !== 'string' ||
    value.some((item) => typeof item !== 'string')
  )
    return null;
  return value.includes(expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
