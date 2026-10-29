import { getComponentType } from './component-registry';
import type { ComponentType } from './components/component-type';
import { validateCondition } from './conditions';
import type { DataCollectionLimits } from './data-collection-limits';
import { createDefinitionIndex } from './definition-index';
import type {
  DataClass,
  FormAction,
  FormComponent,
  FormDefinition,
  FormSection,
  FormStyle,
} from './form-definition.model';
import { isValidIsoDate } from './formats';
import {
  boolProp,
  intProp,
  isRecord,
  numberProp,
  optionValues,
  propsOf,
  richTextProp,
  stringProp,
} from './properties';
import { richTextCharacterCount, richTextPlainText, validateRichText } from './rich-text';
import { issue, report, type ValidationIssue, type ValidationReport } from './validation';

const dataClassRank: Record<DataClass, number> = {
  general: 0,
  financial: 1,
  personal: 2,
  restricted: 3,
};
const fileTypes = new Set(['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx', 'csv', 'txt']);
const autocompleteValues = new Set([
  'name',
  'given-name',
  'family-name',
  'organization',
  'street-address',
  'address-line1',
  'address-line2',
  'address-level2',
  'address-level1',
  'postal-code',
  'bday',
  'email',
  'tel',
  'off',
]);
// PrefillSource cerrado (P-13.1).
const prefillSources = new Set(['previousRequest', 'customer.displayName']);
const textColors: readonly string[] = [
  'ink',
  'secondary',
  'muted',
  'brand',
  'accent',
  'success',
  'warning',
  'danger',
  'info',
];
const backgrounds: readonly string[] = [
  'none',
  'surface',
  'sunken',
  'brandSubtle',
  'accentSubtle',
  'sand',
  'sage',
];
// Matriz aprobada (P-20.1): fondo → colores de texto permitidos; lo que no está, se rechaza.
const approvedContrast: Readonly<Record<string, readonly string[]>> = {
  none: ['ink', 'secondary', 'muted', 'brand', 'accent', 'success', 'warning', 'danger', 'info'],
  surface: ['ink', 'secondary', 'muted', 'brand', 'accent', 'success', 'warning', 'danger', 'info'],
  sunken: ['ink', 'secondary', 'brand', 'accent', 'success', 'warning', 'danger', 'info'],
  brandSubtle: ['ink', 'secondary', 'muted', 'accent', 'success', 'warning', 'danger', 'info'],
  accentSubtle: ['ink', 'secondary', 'muted', 'brand', 'success', 'warning', 'danger', 'info'],
  sand: ['ink', 'secondary', 'muted', 'brand', 'accent', 'success', 'danger', 'info'],
  sage: ['ink', 'secondary', 'muted', 'brand', 'accent', 'warning', 'danger', 'info'],
};
const taxIdWords = /\b(ssn|social security|itin|ein|tax id)\b/i;
const unsupportedWords = /\b(bank account|routing number|card number|cvv|pin|password)\b/i;

export function validateForDraft(
  definition: FormDefinition,
  limits: DataCollectionLimits,
): ValidationReport {
  return validateStructure(definition, limits, false);
}

export function validateForPublish(
  definition: FormDefinition,
  limits: DataCollectionLimits,
): ValidationReport {
  return validateStructure(definition, limits, true);
}

function validateStructure(
  definition: FormDefinition,
  limits: DataCollectionLimits,
  publish: boolean,
): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (definition.schemaVersion !== 1)
    issues.push(issue('definition.unsupported_schema_version', '/schemaVersion'));
  if (
    typeof definition.title !== 'string' ||
    definition.title.trim().length === 0 ||
    definition.title.length > 200 ||
    hasControl(definition.title)
  )
    issues.push(issue('props.out_of_range', '/title'));
  issues.push(...validateRichText(definition.description, '/description', 2_000));
  if (!Array.isArray(definition.pages)) return report(issues);
  if (publish) {
    if (definition.pages.length < 1) issues.push(issue('page.required', '/pages'));
    if (definition.pages.length > limits.maxPages)
      issues.push(issue('limits.too_many_pages', '/pages'));
    if (definition.presentation === 'singlePage' && definition.pages.length !== 1)
      issues.push(issue('page.single_page_violation', '/pages'));
  }

  const index = createDefinitionIndex(definition);
  const ids = new Set<string>();
  const keys = new Set<string>();
  let componentCount = 0;
  let order = 0;
  let signatureSteps = 0;

  definition.pages.forEach((page, pageIndex) => {
    const pagePath = `/pages/${pageIndex}`;
    order++;
    validateId(page.id, /^pg_[a-z0-9]{8,16}$/, pagePath, ids, issues);
    if (
      publish &&
      definition.presentation === 'wizard' &&
      (typeof page.title !== 'string' || page.title.trim().length === 0)
    )
      issues.push(issue('page.title_required', `${pagePath}/title`));
    if (page.title != null && page.title.length > 120)
      issues.push(issue('props.out_of_range', `${pagePath}/title`));
    issues.push(...validateRichText(page.description, `${pagePath}/description`, 2_000));
    validateStyle(page.style, `${pagePath}/style`, issues);
    if (publish)
      validateCondition(
        page.visibleWhen,
        `${pagePath}/visibleWhen`,
        order,
        null,
        index,
        limits,
        issues,
      );
    if (!Array.isArray(page.sections)) return;
    // Vacío no es "demasiados": código propio, como page.required.
    if (publish && page.sections.length < 1) issues.push(issue('section.required', `${pagePath}/sections`));
    if (page.sections.length > limits.maxSectionsPerPage)
      issues.push(issue('limits.too_many_sections', `${pagePath}/sections`));

    page.sections.forEach((section, sectionIndex) => {
      const sectionPath = `${pagePath}/sections/${sectionIndex}`;
      order++;
      validateSection(section, sectionPath, order, index, ids, limits, publish, issues);
      componentCount += section.components?.length ?? 0;
      (section.components ?? []).forEach((component, componentIndex) => {
        const componentPath = `${sectionPath}/components/${componentIndex}`;
        order++;
        validateComponent(
          component,
          componentPath,
          order,
          section,
          index,
          ids,
          keys,
          limits,
          publish,
          issues,
        );
        if (component.type === 'signatureStep') signatureSteps++;
      });
    });
  });
  if (componentCount > limits.maxComponents)
    issues.push(issue('limits.too_many_components', '/pages'));
  if (publish) {
    validateMappingShape(definition, index, issues);
    validateActions(definition, signatureSteps, index, limits, issues);
  }
  return report(issues);
}

function validateSection(
  section: FormSection,
  path: string,
  order: number,
  index: ReturnType<typeof createDefinitionIndex>,
  ids: Set<string>,
  limits: DataCollectionLimits,
  publish: boolean,
  issues: ValidationIssue[],
): void {
  validateId(section.id, /^sc_[a-z0-9]{8,16}$/, path, ids, issues);
  if (section.title != null && section.title.length > 120)
    issues.push(issue('props.out_of_range', `${path}/title`));
  if (
    publish &&
    section.repeat != null &&
    (typeof section.title !== 'string' || section.title.trim().length === 0)
  )
    issues.push(issue('section.title_required', `${path}/title`));
  issues.push(...validateRichText(section.description, `${path}/description`, 2_000));
  validateStyle(section.style, `${path}/style`, issues);
  if (publish)
    validateCondition(
      section.visibleWhen,
      `${path}/visibleWhen`,
      order,
      null,
      index,
      limits,
      issues,
    );
  if (section.repeat != null) {
    const repeat = section.repeat;
    if (
      !Number.isInteger(repeat.minRows) ||
      !Number.isInteger(repeat.maxRows) ||
      repeat.minRows < 0 ||
      repeat.maxRows < 1 ||
      repeat.minRows > repeat.maxRows ||
      repeat.maxRows > limits.maxRepeaterRows ||
      typeof repeat.addLabel !== 'string' ||
      repeat.addLabel.trim().length === 0 ||
      repeat.addLabel.length > 60 ||
      typeof repeat.rowLabel !== 'string' ||
      repeat.rowLabel.trim().length === 0 ||
      repeat.rowLabel.length > 60
    ) {
      issues.push(issue('repeater.invalid_bounds', `${path}/repeat`));
    }
  }
  if (!Array.isArray(section.components)) return;
  if (publish && section.components.length < 1) issues.push(issue('component.required', `${path}/components`));
  if (section.components.length > limits.maxComponentsPerSection)
    issues.push(issue('limits.too_many_components', `${path}/components`));
}

function validateComponent(
  component: FormComponent,
  path: string,
  order: number,
  section: FormSection,
  index: ReturnType<typeof createDefinitionIndex>,
  ids: Set<string>,
  keys: Set<string>,
  limits: DataCollectionLimits,
  publish: boolean,
  issues: ValidationIssue[],
): void {
  validateId(component.id, /^fd_[a-z0-9]{8,16}$/, path, ids, issues);
  if (component.key != null) {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(component.key))
      issues.push(issue('key.invalid_format', `${path}/key`, component.id));
    else if (keys.has(component.key))
      issues.push(issue('key.duplicate', `${path}/key`, component.id));
    else keys.add(component.key);
  }
  if (component.reportable === true && component.key == null)
    issues.push(issue('key.required', `${path}/key`, component.id));
  const type = getComponentType(component.type);
  if (type == null) {
    issues.push(issue('component.unknown_type', `${path}/type`, component.id));
    return;
  }
  if (!publish) return;
  validateComponentProperties(component, type, path, limits, issues);
  validateStyleAgainstSection(component.style, section.style, `${path}/style`, issues);
  validateCondition(
    component.visibleWhen,
    `${path}/visibleWhen`,
    order,
    section.repeat == null ? null : section.id,
    index,
    limits,
    issues,
  );
  validateCondition(
    component.requiredWhen,
    `${path}/requiredWhen`,
    order,
    section.repeat == null ? null : section.id,
    index,
    limits,
    issues,
  );
}

function validateComponentProperties(
  component: FormComponent,
  type: ComponentType,
  path: string,
  limits: DataCollectionLimits,
  issues: ValidationIssue[],
): void {
  validateCommon(component, type, path, limits, issues);
  if (component.props != null && !isRecord(component.props)) {
    issues.push(issue('props.required', `${path}/props`, component.id));
    return;
  }
  const props = propsOf(component.props);
  for (const name of Object.keys(props)) {
    if (!type.allowedProperties.has(name))
      issues.push(issue('props.unknown', `${path}/props/${name}`, component.id));
  }
  if (!validatePropertyTypes(component, path, issues)) return;
  switch (component.type) {
    case 'heading':
      validatePlain(component, 'text', 1, 200, path, issues);
      if (![2, 3].includes(intProp(props, 'level', 2)))
        issues.push(issue('props.out_of_range', `${path}/props/level`, component.id));
      break;
    case 'paragraph':
      validateRequiredRichText(component, 'text', limits.maxParagraphLength, path, issues);
      break;
    case 'callout':
      validateEnum(component, 'tone', ['info', 'warning', 'success'], path, issues, false, 'info');
      if ('title' in props) validatePlain(component, 'title', 0, 120, path, issues);
      validateRequiredRichText(component, 'text', 2_000, path, issues);
      break;
    case 'spacer':
      validateEnum(component, 'size', ['2', '4', '6', '8'], path, issues, true);
      break;
    case 'consent':
      validateConsent(component, path, issues);
      break;
    case 'signatureStep':
      validateEnum(component, 'documentSource', ['submissionSummary'], path, issues, true);
      validateEnum(component, 'verification', ['emailOtp', 'smsOtp'], path, issues, true);
      validateOptionalRichText(component, 'instructions', 1_000, path, issues);
      break;
    case 'text':
      validateTextProps(component, path, issues);
      break;
    case 'textarea': {
      const max = intProp(props, 'maxLength', 2_000);
      const rows = intProp(props, 'rows', 4);
      if (max < 1 || max > 10_000 || rows < 2 || rows > 12)
        issues.push(issue('props.out_of_range', `${path}/props`, component.id));
      break;
    }
    case 'number': {
      const decimals = intProp(props, 'decimals', 0);
      const min = numberProp(props, 'min');
      const max = numberProp(props, 'max');
      if (decimals < 0 || decimals > 6 || (min != null && max != null && min > max))
        issues.push(issue('props.out_of_range', `${path}/props`, component.id));
      const unit = stringProp(props, 'unitLabel');
      if (unit != null && unit.length > 20)
        issues.push(issue('props.out_of_range', `${path}/props/unitLabel`, component.id));
      break;
    }
    case 'currency': {
      validateEnum(component, 'currency', ['USD'], path, issues, false, 'USD');
      const min = numberProp(props, 'min') ?? 0;
      const max = numberProp(props, 'max');
      if (max != null && min > max)
        issues.push(issue('props.out_of_range', `${path}/props`, component.id));
      break;
    }
    case 'date':
      for (const name of ['min', 'max']) {
        const value = stringProp(props, name);
        if (value != null && value !== 'today' && !isValidIsoDate(value))
          issues.push(issue('props.out_of_range', `${path}/props/${name}`, component.id));
      }
      break;
    case 'phone':
      validateEnum(component, 'defaultCountry', ['US'], path, issues, false, 'US');
      break;
    case 'select':
      validateChoice(component, path, limits, 1, issues);
      if ('placeholder' in props) validatePlain(component, 'placeholder', 0, 60, path, issues);
      break;
    case 'radio':
      validateChoice(component, path, limits, 2, issues);
      validateEnum(
        component,
        'layout',
        ['vertical', 'horizontal'],
        path,
        issues,
        false,
        'vertical',
      );
      break;
    case 'checkboxGroup':
      validateChoice(component, path, limits, 1, issues);
      {
        const count = optionValues(props).size;
        const min = intProp(props, 'minSelected', 0);
        const max = intProp(props, 'maxSelected', count);
        if (min < 0 || max < min || max > count)
          issues.push(issue('props.out_of_range', `${path}/props`, component.id));
      }
      break;
    case 'yesNo':
      for (const name of ['yesLabel', 'noLabel']) {
        const value = stringProp(props, name);
        if (value != null && (value.length < 1 || value.length > 30))
          issues.push(issue('props.out_of_range', `${path}/props/${name}`, component.id));
      }
      break;
    case 'checkbox':
      validateRequiredRichText(component, 'text', 500, path, issues);
      break;
    case 'file':
      validateFile(component, path, limits, issues);
      break;
    case 'address':
      validateEnum(component, 'country', ['US'], path, issues, false, 'US');
      break;
    case 'taxId': {
      const kinds = props['kinds'];
      if (
        kinds != null &&
        (!Array.isArray(kinds) ||
          kinds.length === 0 ||
          kinds.some((kind) => typeof kind !== 'string' || !['ssn', 'itin', 'ein'].includes(kind)))
      )
        issues.push(issue('props.out_of_range', `${path}/props/kinds`, component.id));
      break;
    }
  }
}

function validateCommon(
  component: FormComponent,
  type: ComponentType,
  path: string,
  limits: DataCollectionLimits,
  issues: ValidationIssue[],
): void {
  if (type.kind === 'input') {
    if (typeof component.label !== 'string' || component.label.trim().length === 0)
      issues.push(issue('component.label_required', `${path}/label`, component.id));
    else if (component.label.length > limits.maxLabelLength)
      issues.push(issue('props.out_of_range', `${path}/label`, component.id));
    const declared = component.dataClass ?? type.minimumDataClass!;
    if (
      dataClassRank[declared] < dataClassRank[type.minimumDataClass!] ||
      (component.type === 'taxId' && declared !== 'restricted')
    )
      issues.push(issue('dataclass.below_minimum', `${path}/dataClass`, component.id));
    if (component.required === true && component.requiredWhen != null)
      issues.push(issue('required.conflict', path, component.id));
    if (
      component.reportable === true &&
      (declared === 'personal' ||
        declared === 'restricted' ||
        component.type === 'taxId' ||
        component.type === 'file')
    )
      issues.push(issue('reportable.not_allowed', `${path}/reportable`, component.id));
    if (component.prefill != null && (component.type === 'taxId' || component.type === 'file'))
      issues.push(issue('prefill.not_allowed', `${path}/prefill`, component.id));
    else if (component.prefill != null && !prefillSources.has(component.prefill.source ?? ''))
      issues.push(issue('prefill.invalid_source', `${path}/prefill/source`, component.id));
  } else {
    if (component.label != null)
      issues.push(issue('component.label_not_allowed', `${path}/label`, component.id));
    if (
      component.key != null ||
      component.required === true ||
      component.requiredWhen != null ||
      component.reportable === true ||
      component.prefill != null ||
      component.dataClass != null
    )
      issues.push(issue('props.unknown', path, component.id));
  }
  const staffText = `${component.label ?? ''} ${richTextPlainText(component.help)}`;
  if (taxIdWords.test(staffText) && component.type !== 'taxId')
    issues.push(issue('component.restricted_requires_taxid', path, component.id));
  if (unsupportedWords.test(staffText))
    issues.push(issue('component.unsupported_restricted_data', path, component.id));
  issues.push(
    ...validateRichText(component.help, `${path}/help`, limits.maxHelpTextLength).map((item) => ({
      ...item,
      componentId: component.id,
    })),
  );
  validateStyle(component.style, `${path}/style`, issues);
}

function validatePropertyTypes(
  component: FormComponent,
  path: string,
  issues: ValidationIssue[],
): boolean {
  let valid = true;
  for (const [name, value] of Object.entries(propsOf(component.props))) {
    const kind = expectedKind(component.type, name);
    const kindValid =
      kind === 'number'
        ? typeof value === 'number'
        : kind === 'boolean'
          ? typeof value === 'boolean'
          : kind === 'array'
            ? Array.isArray(value)
            : kind === 'richtext'
              ? value == null || isRecord(value)
              : typeof value === 'string';
    const decimalProperty =
      ['min', 'max'].includes(name) && ['number', 'currency'].includes(component.type);
    const numberValid =
      typeof value !== 'number' ||
      (Number.isFinite(value) &&
        (decimalProperty ||
          (Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647)));
    if (!kindValid || !numberValid) {
      issues.push(issue('props.out_of_range', `${path}/props/${name}`, component.id));
      valid = false;
    }
  }
  return valid;
}

function expectedKind(
  type: string,
  name: string,
): 'string' | 'number' | 'boolean' | 'array' | 'richtext' {
  if (
    (type === 'heading' && name === 'level') ||
    (type === 'consent' && name === 'noticeVersionNumber') ||
    (['text'].includes(type) && ['maxLength', 'minLength'].includes(name)) ||
    (type === 'textarea' && ['maxLength', 'rows'].includes(name)) ||
    (type === 'number' && name === 'decimals') ||
    (type === 'checkboxGroup' && ['minSelected', 'maxSelected'].includes(name)) ||
    (type === 'file' && ['maxFiles', 'maxFileBytes'].includes(name)) ||
    (['number', 'currency'].includes(type) && ['min', 'max'].includes(name))
  )
    return 'number';
  if (
    (type === 'consent' && name === 'blocking') ||
    (type === 'currency' && name === 'allowNegative')
  )
    return 'boolean';
  if (
    (['paragraph', 'callout', 'checkbox'].includes(type) && name === 'text') ||
    (['signatureStep', 'file'].includes(type) && name === 'instructions')
  )
    return 'richtext';
  if (
    (['select', 'radio', 'checkboxGroup'].includes(type) && name === 'options') ||
    (type === 'file' && name === 'allowedTypes') ||
    (type === 'taxId' && name === 'kinds')
  )
    return 'array';
  return 'string';
}

function validateTextProps(
  component: FormComponent,
  path: string,
  issues: ValidationIssue[],
): void {
  const max = intProp(component.props, 'maxLength', 200);
  const min = intProp(component.props, 'minLength', 0);
  if (max < 1 || max > 1_000 || min < 0 || min > max)
    issues.push(issue('props.out_of_range', `${path}/props`, component.id));
  const autocomplete = stringProp(component.props, 'autocomplete');
  if (autocomplete != null && !autocompleteValues.has(autocomplete))
    issues.push(issue('props.out_of_range', `${path}/props/autocomplete`, component.id));
}

function validateChoice(
  component: FormComponent,
  path: string,
  limits: DataCollectionLimits,
  minimum: number,
  issues: ValidationIssue[],
): void {
  const options = propsOf(component.props)['options'];
  if (!Array.isArray(options)) {
    issues.push(issue('props.required', `${path}/props/options`, component.id));
    return;
  }
  if (options.length < minimum)
    issues.push(issue('options.too_few', `${path}/props/options`, component.id));
  if (options.length > limits.maxOptionsPerChoice)
    issues.push(issue('options.too_many', `${path}/props/options`, component.id));
  const values = new Set<string>();
  options.forEach((option, index) => {
    const optionPath = `${path}/props/options/${index}`;
    if (!isRecord(option) || !('value' in option) || !('label' in option)) {
      issues.push(issue('props.required', optionPath, component.id));
      return;
    }
    const value = option['value'];
    const label = option['label'];
    if (typeof value !== 'string' || !/^[a-z0-9_]{1,64}$/.test(value))
      issues.push(issue('props.out_of_range', `${optionPath}/value`, component.id));
    else if (values.has(value))
      issues.push(issue('options.duplicate_value', `${optionPath}/value`, component.id));
    else values.add(value);
    if (typeof label !== 'string' || label.trim().length === 0 || label.length > 200)
      issues.push(issue('props.out_of_range', `${optionPath}/label`, component.id));
    if (Object.keys(option).some((key) => key !== 'value' && key !== 'label'))
      issues.push(issue('props.unknown', optionPath, component.id));
  });
}

function validateConsent(component: FormComponent, path: string, issues: ValidationIssue[]): void {
  validatePlain(component, 'noticeKey', 1, 120, path, issues);
  if (intProp(component.props, 'noticeVersionNumber', 0) < 1)
    issues.push(issue('props.out_of_range', `${path}/props/noticeVersionNumber`, component.id));
  validateEnum(component, 'mode', ['noticeOnly', 'acceptance'], path, issues, true);
  const mode = stringProp(component.props, 'mode');
  const timing = stringProp(component.props, 'timing');
  const blocking = boolProp(component.props, 'blocking', false);
  if (mode === 'acceptance') {
    if (timing !== 'beforeCollection' && timing !== 'beforeSubmit')
      issues.push(issue('props.required', `${path}/props/timing`, component.id));
    validatePlain(component, 'acceptanceText', 1, 300, path, issues);
  } else if (timing != null)
    issues.push(issue('props.unknown', `${path}/props/timing`, component.id));
  if (mode !== 'acceptance' && blocking)
    issues.push(issue('props.unknown', `${path}/props/blocking`, component.id));
}

function validateFile(
  component: FormComponent,
  path: string,
  limits: DataCollectionLimits,
  issues: ValidationIssue[],
): void {
  const maxFiles = intProp(component.props, 'maxFiles', 5);
  const maxBytes = intProp(component.props, 'maxFileBytes', 10_485_760);
  if (maxFiles < 1 || maxFiles > limits.maxFilesPerField)
    issues.push(issue('props.out_of_range', `${path}/props/maxFiles`, component.id));
  if (maxBytes < 1 || maxBytes > limits.maxFileBytes)
    issues.push(issue('file.size_exceeds_platform', `${path}/props/maxFileBytes`, component.id));
  const allowed = propsOf(component.props)['allowedTypes'];
  if (
    allowed != null &&
    (!Array.isArray(allowed) ||
      allowed.length === 0 ||
      allowed.some((value) => typeof value !== 'string' || !fileTypes.has(value)))
  )
    issues.push(issue('file.type_not_allowed', `${path}/props/allowedTypes`, component.id));
  validateOptionalRichText(component, 'instructions', 1_000, path, issues);
}

function validateRequiredRichText(
  component: FormComponent,
  name: string,
  max: number,
  path: string,
  issues: ValidationIssue[],
): void {
  const props = propsOf(component.props);
  if (!(name in props)) {
    issues.push(issue('props.required', `${path}/props/${name}`, component.id));
    return;
  }
  const text = richTextProp(props, name);
  if (props[name] != null && text == null) {
    issues.push(issue('richtext.invalid_node', `${path}/props/${name}`, component.id));
    return;
  }
  issues.push(
    ...validateRichText(text, `${path}/props/${name}`, max).map((item) => ({
      ...item,
      componentId: component.id,
    })),
  );
  if (richTextCharacterCount(text) === 0)
    issues.push(issue('props.required', `${path}/props/${name}`, component.id));
}

function validateOptionalRichText(
  component: FormComponent,
  name: string,
  max: number,
  path: string,
  issues: ValidationIssue[],
): void {
  const props = propsOf(component.props);
  if (!(name in props)) return;
  const text = richTextProp(props, name);
  if (props[name] != null && text == null)
    issues.push(issue('richtext.invalid_node', `${path}/props/${name}`, component.id));
  issues.push(
    ...validateRichText(text, `${path}/props/${name}`, max).map((item) => ({
      ...item,
      componentId: component.id,
    })),
  );
}

function validatePlain(
  component: FormComponent,
  name: string,
  min: number,
  max: number,
  path: string,
  issues: ValidationIssue[],
): void {
  const value = stringProp(component.props, name);
  if (value == null || value.length < min || value.length > max || hasControl(value))
    issues.push(issue('props.out_of_range', `${path}/props/${name}`, component.id));
}

function validateEnum(
  component: FormComponent,
  name: string,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
  required: boolean,
  fallback: string | null = null,
): void {
  const value = stringProp(component.props, name) ?? fallback;
  if (value == null && required)
    issues.push(issue('props.required', `${path}/props/${name}`, component.id));
  else if (value != null && !allowed.includes(value))
    issues.push(issue('props.out_of_range', `${path}/props/${name}`, component.id));
}

function validateStyle(
  style: FormStyle | null | undefined,
  path: string,
  issues: ValidationIssue[],
): void {
  if (style == null) return;
  const checks: [unknown, readonly unknown[], string][] = [
    [style.width, ['full', 'half', 'third', 'twoThirds'], 'width'],
    [style.align, ['left', 'center', 'right'], 'align'],
    [style.textSize, ['caption', 'ui', 'body', 'h3', 'h2', 'h1'], 'textSize'],
    [style.textColor, textColors, 'textColor'],
    [style.background, backgrounds, 'background'],
    [style.spacingTop, [0, 2, 4, 6, 8], 'spacingTop'],
    [style.spacingBottom, [0, 2, 4, 6, 8], 'spacingBottom'],
  ];
  for (const [value, allowed, name] of checks)
    if (value != null && !allowed.includes(value))
      issues.push(issue('style.token_invalid', `${path}/${name}`));
  if (!contrastAllowed(style.textColor, style.background))
    issues.push(issue('style.contrast_not_allowed', path));
}

// Un componente sin fondo propio (o `none`) pinta su texto sobre el fondo de la sección padre.
function validateStyleAgainstSection(
  style: FormStyle | null | undefined,
  sectionStyle: FormStyle | null | undefined,
  path: string,
  issues: ValidationIssue[],
): void {
  if (style?.textColor == null || (style.background != null && style.background !== 'none')) return;
  if (!contrastAllowed(style.textColor, sectionStyle?.background))
    issues.push(issue('style.contrast_not_allowed', path));
}

function contrastAllowed(
  color: string | null | undefined,
  background: string | null | undefined,
): boolean {
  // Un token inválido ya se reporta como style.token_invalid.
  if (color == null || background == null) return true;
  if (!textColors.includes(color) || !backgrounds.includes(background)) return true;
  return approvedContrast[background]?.includes(color) === true;
}

function validateMappingShape(
  definition: FormDefinition,
  index: ReturnType<typeof createDefinitionIndex>,
  issues: ValidationIssue[],
): void {
  const mapped = new Set<string>();
  (definition.mappings ?? []).forEach((mapping, mappingIndex) => {
    const path = `/mappings/${mappingIndex}`;
    if (!index.components.has(mapping.componentId) && !index.sections.has(mapping.componentId))
      issues.push(issue('mapping.invalid_target', `${path}/componentId`, mapping.componentId));
    if (typeof mapping.targetKey !== 'string' || mapping.targetKey.trim().length === 0)
      issues.push(issue('mapping.invalid_target', `${path}/targetKey`, mapping.componentId));
    if (mapped.has(mapping.componentId))
      issues.push(issue('mapping.duplicate_target', path, mapping.componentId));
    else mapped.add(mapping.componentId);
  });
}

function validateActions(
  definition: FormDefinition,
  signatureSteps: number,
  index: ReturnType<typeof createDefinitionIndex>,
  limits: DataCollectionLimits,
  issues: ValidationIssue[],
): void {
  const keys = new Set<string>();
  let hasSignature = false;
  (definition.actions ?? []).forEach((action, actionIndex) => {
    const path = `/actions/${actionIndex}`;
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(action.key) || keys.has(action.key))
      issues.push(issue('key.invalid_format', `${path}/key`));
    else keys.add(action.key);
    if (!triggerAllowed(action)) issues.push(issue('props.out_of_range', `${path}/trigger`));
    if (action.type === 'notifyStaff' || action.type === 'routeToReview')
      issues.push(issue('props.out_of_range', `${path}/type`));
    validateActionConfig(action, path, issues);
    if (signatureSteps === 0 && waitsForSignature(action))
      issues.push(issue('signature.step_missing', `${path}/config/waitFor`));
    validateCondition(
      action.condition,
      `${path}/condition`,
      Number.MAX_SAFE_INTEGER,
      null,
      index,
      limits,
      issues,
    );
    hasSignature ||= action.type === 'requestSignature';
  });
  if (signatureSteps > 1) issues.push(issue('props.out_of_range', '/pages'));
  if ((signatureSteps === 1) !== hasSignature)
    issues.push(issue('signature.action_missing', '/actions'));
}

function waitsForSignature(action: FormAction): boolean {
  return (
    action.type === 'createCustomer' &&
    isRecord(action.config) &&
    action.config['waitFor'] === 'signatureCompleted'
  );
}

function validateActionConfig(action: FormAction, path: string, issues: ValidationIssue[]): void {
  if (action.config == null) return;
  if (!isRecord(action.config)) {
    issues.push(issue('props.out_of_range', `${path}/config`));
    return;
  }
  if (action.type !== 'createCustomer') {
    if (Object.keys(action.config).length > 0)
      issues.push(issue('props.unknown', `${path}/config`));
    return;
  }
  const allowed = new Set(['kind', 'language', 'postCreate', 'waitFor']);
  for (const name of Object.keys(action.config))
    if (!allowed.has(name)) issues.push(issue('props.unknown', `${path}/config/${name}`));
  for (const name of ['kind', 'language'])
    if (name in action.config && !isActionValueSource(action.config[name]))
      issues.push(issue('props.out_of_range', `${path}/config/${name}`));
  if (
    'waitFor' in action.config &&
    action.config['waitFor'] !== 'none' &&
    action.config['waitFor'] !== 'signatureCompleted'
  )
    issues.push(issue('props.out_of_range', `${path}/config/waitFor`));
  if ('postCreate' in action.config) {
    const value = action.config['postCreate'];
    if (
      !Array.isArray(value) ||
      value.some((item) => item !== 'primaryAddress') ||
      new Set(value).size !== value.length
    )
      issues.push(issue('props.out_of_range', `${path}/config/postCreate`));
  }
}

function isActionValueSource(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 1) return false;
  return (
    (typeof value['constant'] === 'string' && value['constant'].trim().length > 0) ||
    value['mapped'] === true
  );
}

function triggerAllowed(action: FormAction): boolean {
  if (action.type === 'notifyStaff' || action.type === 'routeToReview')
    return action.trigger === 'onSubmit';
  if (action.type === 'generateSummary' || action.type === 'requestSignature')
    return action.trigger === 'onSubmit' || action.trigger === 'onComplete';
  if (action.type === 'createCustomer')
    return action.trigger === 'onSubmit' || action.trigger === 'manual';
  if (action.type === 'updateCustomerProfile') return action.trigger === 'manual';
  if (action.type === 'applyRetentionClass') return action.trigger === 'onComplete';
  return false;
}

function validateId(
  id: string,
  pattern: RegExp,
  path: string,
  ids: Set<string>,
  issues: ValidationIssue[],
): void {
  if (typeof id !== 'string' || !pattern.test(id))
    issues.push(issue('id.invalid_format', `${path}/id`, id));
  else if (ids.has(id)) issues.push(issue('id.duplicate', `${path}/id`, id));
  else ids.add(id);
}

function hasControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}
