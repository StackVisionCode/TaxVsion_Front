import { getComponentType } from './component-registry';
import { evaluateCondition, isAnswered } from './conditions';
import type { DataCollectionLimits } from './data-collection-limits';
import { createDefinitionIndex, type DefinitionIndex } from './definition-index';
import type { AnswersValidationMode, FormAnswers, RepeaterRow } from './form-answers.model';
import type { FormComponent, FormDefinition, FormSection } from './form-definition.model';
import {
  isValidEmail,
  isValidIsoDate,
  isValidPhone,
  isValidPostalCode,
  looksLikeCardNumber,
  looksLikeTaxIdentifier,
  parsePlainNumber,
  US_STATE_CODES,
} from './formats';
import { boolProp, intProp, isRecord, numberProp, optionValues, stringProp } from './properties';
import { issue, report, type ValidationIssue, type ValidationReport } from './validation';
import type { VisibilityMap } from './visibility';

const ROW_ID_PATTERN = /^rw_[a-z0-9]{10}$/;
const NUMBER_PATTERN = /^-?[0-9]{1,15}(\.[0-9]{1,6})?$/;
const CURRENCY_PATTERN = /^-?[0-9]{1,13}(\.[0-9]{1,2})?$/;
const LAST_FOUR_PATTERN = /^[0-9]{4}$/;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateAnswers(
  definition: FormDefinition,
  answers: FormAnswers,
  visibility: VisibilityMap,
  mode: AnswersValidationMode,
  limits: DataCollectionLimits,
  options: { pageId?: string } = {},
): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (answers.schemaVersion !== 1)
    issues.push(issue('definition.unsupported_schema_version', '/schemaVersion'));
  const index = createDefinitionIndex(definition);
  validateRootKeys(answers, index, issues);
  for (const page of definition.pages ?? []) {
    if (options.pageId != null && page.id !== options.pageId) continue;
    if (!shouldValidate(visibility.isVisible(page.id), mode)) continue;
    for (const section of page.sections ?? []) {
      if (!shouldValidate(visibility.isVisible(section.id), mode)) continue;
      if (section.repeat == null)
        validateRegularSection(
          section,
          definition,
          answers,
          index,
          visibility,
          mode,
          limits,
          issues,
        );
      else validateRepeater(section, definition, answers, index, visibility, mode, limits, issues);
    }
  }
  return report(issues);
}

// El borrador conserva y valida valores ocultos, pero no exige requeridos.
function shouldValidate(visible: boolean, mode: AnswersValidationMode): boolean {
  return visible || mode === 'draft';
}

function validateRootKeys(
  answers: FormAnswers,
  index: DefinitionIndex,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(answers.values ?? {})) {
    const component = index.components.get(key);
    const knownComponent =
      component?.repeaterSectionId == null && component?.componentType?.kind === 'input';
    const knownRepeater = index.sections.get(key)?.section.repeat != null;
    if (!knownComponent && !knownRepeater)
      issues.push(issue('answer.unknown_component', `/values/${key}`, key));
  }
}

function validateRegularSection(
  section: FormSection,
  definition: FormDefinition,
  answers: FormAnswers,
  index: DefinitionIndex,
  visibility: VisibilityMap,
  mode: AnswersValidationMode,
  limits: DataCollectionLimits,
  issues: ValidationIssue[],
): void {
  for (const component of section.components ?? []) {
    if (
      !shouldValidate(visibility.isVisible(component.id), mode) ||
      getComponentType(component.type)?.kind !== 'input'
    )
      continue;
    validateComponent(
      component,
      answers.values?.[component.id],
      `/values/${component.id}`,
      definition,
      answers,
      index,
      visibility,
      mode,
      null,
      null,
      limits,
      issues,
    );
  }
}

function validateRepeater(
  section: FormSection,
  definition: FormDefinition,
  answers: FormAnswers,
  index: DefinitionIndex,
  visibility: VisibilityMap,
  mode: AnswersValidationMode,
  limits: DataCollectionLimits,
  issues: ValidationIssue[],
): void {
  const raw = answers.values?.[section.id];
  if (raw == null) {
    if (mode === 'submit' && (section.repeat?.minRows ?? 0) > 0)
      issues.push(issue('answer.rows_below_min', `/values/${section.id}`));
    return;
  }
  const rows = tryReadRows(raw);
  if (rows == null) {
    issues.push(issue('answer.type_mismatch', `/values/${section.id}`));
    return;
  }
  const maxRows = Math.min(section.repeat?.maxRows ?? 0, limits.maxRepeaterRows);
  if (rows.length > maxRows)
    issues.push(issue('answer.rows_above_max', `/values/${section.id}/rows`));
  if (mode === 'submit' && rows.length < (section.repeat?.minRows ?? 0))
    issues.push(issue('answer.rows_below_min', `/values/${section.id}/rows`));

  const components = new Map(
    (section.components ?? []).map((component) => [component.id, component]),
  );
  const rowIds = new Set<string>();
  rows.slice(0, maxRows).forEach((row, rowIndex) => {
    const rowPath = `/values/${section.id}/rows/${rowIndex}`;
    if (!ROW_ID_PATTERN.test(row.rowId))
      issues.push(issue('answer.row_id_invalid', `${rowPath}/rowId`, null, row.rowId));
    else if (rowIds.has(row.rowId))
      issues.push(issue('answer.row_id_duplicate', `${rowPath}/rowId`, null, row.rowId));
    else rowIds.add(row.rowId);

    for (const key of Object.keys(row.values)) {
      const known = components.get(key);
      if (known == null || getComponentType(known.type)?.kind !== 'input')
        issues.push(issue('answer.unknown_component', `${rowPath}/values/${key}`, key, row.rowId));
    }
    for (const component of section.components ?? []) {
      if (
        !shouldValidate(visibility.isRowVisible(component.id, row.rowId), mode) ||
        getComponentType(component.type)?.kind !== 'input'
      )
        continue;
      validateComponent(
        component,
        row.values[component.id],
        `${rowPath}/values/${component.id}`,
        definition,
        answers,
        index,
        visibility,
        mode,
        row.rowId,
        row.values,
        limits,
        issues,
      );
    }
  });
}

function validateComponent(
  component: FormComponent,
  value: unknown,
  path: string,
  definition: FormDefinition,
  answers: FormAnswers,
  index: DefinitionIndex,
  visibility: VisibilityMap,
  mode: AnswersValidationMode,
  rowId: string | null,
  rowValues: Record<string, unknown> | null,
  limits: DataCollectionLimits,
  issues: ValidationIssue[],
): void {
  if (value != null && !hasCompatibleShape(component.type, value)) {
    typeMismatch(component, path, rowId, issues);
    return;
  }
  const answered = isAnswered(value, component.type);
  const required =
    mode === 'submit' &&
    (component.required === true ||
      (component.requiredWhen != null &&
        evaluateCondition(component.requiredWhen, answers, index, visibility, rowId, rowValues)));
  if (required && !answered) {
    issues.push(issue('answer.required', path, component.id, rowId));
    return;
  }
  if (!answered) return;

  switch (component.type) {
    case 'text':
      validateText(component, value, path, rowId, false, issues);
      break;
    case 'textarea':
      validateText(component, value, path, rowId, true, issues);
      break;
    case 'number':
      validateNumber(component, value, path, rowId, false, issues);
      break;
    case 'currency':
      validateNumber(component, value, path, rowId, true, issues);
      break;
    case 'date':
      validateDate(component, value, path, rowId, issues);
      break;
    case 'email':
      if (typeof value !== 'string' || !isValidEmail(value.trim().toLowerCase()))
        issues.push(issue('answer.invalid_email', path, component.id, rowId));
      break;
    case 'phone':
      if (typeof value !== 'string' || !isValidPhone(value))
        issues.push(issue('answer.invalid_phone', path, component.id, rowId));
      break;
    case 'select':
    case 'radio':
      validateChoice(component, value, path, rowId, issues);
      break;
    case 'checkboxGroup':
      validateCheckboxGroup(component, value, path, rowId, issues);
      break;
    case 'yesNo':
      validateBoolean(component, value, path, rowId, false, issues);
      break;
    case 'checkbox':
      validateBoolean(component, value, path, rowId, required, issues);
      break;
    case 'file':
      validateFiles(component, value, path, rowId, limits, issues);
      break;
    case 'address':
      validateAddress(component, value, path, rowId, mode, issues);
      break;
    case 'taxId':
      validateTaxId(component, value, path, rowId, issues);
      break;
    default:
      typeMismatch(component, path, rowId, issues);
      break;
  }
}

function hasCompatibleShape(type: string, value: unknown): boolean {
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
    ].includes(type)
  )
    return typeof value === 'string';
  if (type === 'checkboxGroup' || type === 'file') return Array.isArray(value);
  if (type === 'yesNo' || type === 'checkbox') return typeof value === 'boolean';
  return (type === 'address' || type === 'taxId') && isRecord(value);
}

function validateText(
  component: FormComponent,
  value: unknown,
  path: string,
  rowId: string | null,
  multiline: boolean,
  issues: ValidationIssue[],
): void {
  if (typeof value !== 'string') return typeMismatch(component, path, rowId, issues);
  const text = value.trim();
  const max = intProp(component.props, 'maxLength', multiline ? 2_000 : 200);
  const min = multiline ? 0 : intProp(component.props, 'minLength', 0);
  if (text.length < min) issues.push(issue('answer.too_short', path, component.id, rowId));
  if (text.length > max) issues.push(issue('answer.too_long', path, component.id, rowId));
  if (
    [...text].some(
      (character) =>
        character.charCodeAt(0) < 32 && (!multiline || !['\r', '\n', '\t'].includes(character)),
    )
  )
    issues.push(issue('answer.type_mismatch', path, component.id, rowId));
  if (looksLikeTaxIdentifier(text))
    issues.push(issue('answer.looks_like_tax_identifier', path, component.id, rowId));
  if (looksLikeCardNumber(text))
    issues.push(issue('answer.looks_like_card_number', path, component.id, rowId));
}

function validateNumber(
  component: FormComponent,
  value: unknown,
  path: string,
  rowId: string | null,
  currency: boolean,
  issues: ValidationIssue[],
): void {
  if (typeof value !== 'string' || !(currency ? CURRENCY_PATTERN : NUMBER_PATTERN).test(value))
    return typeMismatch(component, path, rowId, issues);
  const number = parsePlainNumber(value);
  if (number == null) return typeMismatch(component, path, rowId, issues);
  const actualDecimals = value.includes('.') ? value.length - value.indexOf('.') - 1 : 0;
  if (actualDecimals > (currency ? 2 : intProp(component.props, 'decimals', 0)))
    issues.push(issue('answer.too_many_decimals', path, component.id, rowId));
  const min = numberProp(component.props, 'min') ?? (currency ? 0 : null);
  const max = numberProp(component.props, 'max');
  if (currency && number < 0 && !boolProp(component.props, 'allowNegative', false))
    issues.push(issue('answer.out_of_range', path, component.id, rowId));
  if ((min != null && number < min) || (max != null && number > max))
    issues.push(issue('answer.out_of_range', path, component.id, rowId));
}

function validateDate(
  component: FormComponent,
  value: unknown,
  path: string,
  rowId: string | null,
  issues: ValidationIssue[],
): void {
  if (!isValidIsoDate(value)) {
    issues.push(issue('answer.invalid_date', path, component.id, rowId));
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const min = readDateBound(component, 'min', today);
  const max = readDateBound(component, 'max', today);
  if ((min != null && value < min) || (max != null && value > max))
    issues.push(issue('answer.out_of_range', path, component.id, rowId));
}

function readDateBound(component: FormComponent, name: string, today: string): string | null {
  const value = stringProp(component.props, name);
  if (value === 'today') return today;
  return isValidIsoDate(value) ? value : null;
}

function validateChoice(
  component: FormComponent,
  value: unknown,
  path: string,
  rowId: string | null,
  issues: ValidationIssue[],
): void {
  if (typeof value !== 'string' || !optionValues(component.props).has(value))
    issues.push(issue('answer.invalid_option', path, component.id, rowId));
}

function validateCheckboxGroup(
  component: FormComponent,
  value: unknown,
  path: string,
  rowId: string | null,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    return typeMismatch(component, path, rowId, issues);
  const selected = value as string[];
  const allowed = optionValues(component.props);
  if (new Set(selected).size !== selected.length || selected.some((item) => !allowed.has(item)))
    issues.push(issue('answer.invalid_option', path, component.id, rowId));
  const min = intProp(component.props, 'minSelected', 0);
  const max = intProp(component.props, 'maxSelected', allowed.size);
  if (
    selected.length < min ||
    selected.length > max ||
    (component.required === true && selected.length === 0)
  )
    issues.push(issue('answer.selection_count', path, component.id, rowId));
}

function validateBoolean(
  component: FormComponent,
  value: unknown,
  path: string,
  rowId: string | null,
  mustBeTrue: boolean,
  issues: ValidationIssue[],
): void {
  if (typeof value !== 'boolean') typeMismatch(component, path, rowId, issues);
  else if (mustBeTrue && !value)
    issues.push(issue('answer.must_be_checked', path, component.id, rowId));
}

function validateFiles(
  component: FormComponent,
  value: unknown,
  path: string,
  rowId: string | null,
  limits: DataCollectionLimits,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value)) return typeMismatch(component, path, rowId, issues);
  if (value.length > Math.min(intProp(component.props, 'maxFiles', 5), limits.maxFilesPerField))
    issues.push(issue('answer.too_many_files', path, component.id, rowId));
  const ids = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      Object.keys(item).length !== 1 ||
      typeof item['fileId'] !== 'string' ||
      !GUID_PATTERN.test(item['fileId']) ||
      ids.has(item['fileId'])
    )
      typeMismatch(component, path, rowId, issues);
    else ids.add(item['fileId']);
  }
}

function validateAddress(
  component: FormComponent,
  value: unknown,
  path: string,
  rowId: string | null,
  mode: AnswersValidationMode,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) return typeMismatch(component, path, rowId, issues);
  const allowed = new Set(['line1', 'line2', 'city', 'state', 'postalCode', 'country']);
  if (
    Object.entries(value).some(
      ([name, item]) => !allowed.has(name) || (item != null && typeof item !== 'string'),
    )
  )
    return typeMismatch(component, path, rowId, issues);
  const line1 = readTrimmed(value, 'line1');
  const line2 = readTrimmed(value, 'line2');
  const city = readTrimmed(value, 'city');
  const state = readTrimmed(value, 'state');
  const postal = readTrimmed(value, 'postalCode');
  const country = readTrimmed(value, 'country');
  if (mode === 'submit' && (!line1 || !city || !state || !postal))
    issues.push(issue('answer.required', path, component.id, rowId));
  if ((line1?.length ?? 0) > 100 || (line2?.length ?? 0) > 100 || (city?.length ?? 0) > 60)
    issues.push(issue('answer.too_long', path, component.id, rowId));
  if (state != null && !US_STATE_CODES.has(state))
    issues.push(issue('answer.invalid_state', `${path}/state`, component.id, rowId));
  if (postal != null && !isValidPostalCode(postal))
    issues.push(issue('answer.invalid_postal_code', `${path}/postalCode`, component.id, rowId));
  if (country != null && country !== 'US')
    issues.push(issue('answer.type_mismatch', `${path}/country`, component.id, rowId));
}

function validateTaxId(
  component: FormComponent,
  value: unknown,
  path: string,
  rowId: string | null,
  issues: ValidationIssue[],
): void {
  const valid =
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    Object.keys(value).every((name) => ['sensitiveRef', 'last4', 'kind'].includes(name)) &&
    typeof value['sensitiveRef'] === 'string' &&
    GUID_PATTERN.test(value['sensitiveRef']) &&
    typeof value['last4'] === 'string' &&
    LAST_FOUR_PATTERN.test(value['last4']) &&
    typeof value['kind'] === 'string' &&
    allowedTaxKinds(component).has(value['kind']);
  if (!valid) issues.push(issue('answer.sensitive_invalid', path, component.id, rowId));
}

function tryReadRows(value: unknown): RepeaterRow[] | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some((name) => name !== 'rows') ||
    !Array.isArray(value['rows'])
  )
    return null;
  const rows: RepeaterRow[] = [];
  for (const row of value['rows']) {
    if (
      !isRecord(row) ||
      Object.keys(row).some((name) => name !== 'rowId' && name !== 'values') ||
      typeof row['rowId'] !== 'string' ||
      !isRecord(row['values'])
    )
      return null;
    rows.push({ rowId: row['rowId'], values: row['values'] });
  }
  return rows;
}

function allowedTaxKinds(component: FormComponent): Set<string> {
  const kinds = component.props?.['kinds'];
  return Array.isArray(kinds)
    ? new Set(kinds.filter((item): item is string => typeof item === 'string'))
    : new Set(['ssn', 'itin']);
}

function readTrimmed(value: Record<string, unknown>, name: string): string | null {
  return typeof value[name] === 'string' ? value[name].trim() : null;
}

function typeMismatch(
  component: FormComponent,
  path: string,
  rowId: string | null,
  issues: ValidationIssue[],
): void {
  issues.push(issue('answer.type_mismatch', path, component.id, rowId));
}
