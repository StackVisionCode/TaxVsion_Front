import { createDefinitionIndex } from './definition-index';
import type { DraftConflict, DraftConflictTarget } from './draft-save-coordinator';
import type { FormComponent, FormDefinition } from './form-definition.model';
import { maskTaxId, type TaxIdentifierKind } from './formats';
import { isRecord } from './properties';

export type DraftConflictSide = 'base' | 'local' | 'remote';

export interface DraftConflictFormatOptions {
  /** Nombre visible de un archivo por `fileId` (los adjuntos viven fuera de las respuestas). */
  fileName?: (fileId: string) => string | null | undefined;
}

/**
 * Etiqueta legible de un conflicto según la definición: "Income", "Dependent 2" o "Dependent 2 · Name".
 * Uso: `new DraftSaveCoordinator({ ..., labelFor: createDefinitionConflictLabeler(definition) })`.
 */
export function createDefinitionConflictLabeler(
  definition: FormDefinition,
): (target: DraftConflictTarget) => string | null {
  const index = createDefinitionIndex(definition);
  return (target) => {
    const section = target.sectionId ? index.sections.get(target.sectionId)?.section : null;
    const rowName = section
      ? `${section.repeat?.rowLabel?.trim() || section.title?.trim() || 'Row'}${
          target.rowIndex == null ? '' : ` ${target.rowIndex + 1}`
        }`
      : null;
    if (target.rowId != null && target.componentId === target.sectionId) return rowName;
    const label = index.components.get(target.componentId)?.component.label?.trim() || null;
    if (rowName && label) return `${rowName} · ${label}`;
    return label ?? rowName;
  };
}

/** Texto de un lado del conflicto para el diálogo ("On this device: …"). Nunca muestra referencias sensibles. */
export function formatDraftConflictValue(
  definition: FormDefinition,
  conflict: DraftConflict,
  side: DraftConflictSide,
  options: DraftConflictFormatOptions = {},
): string {
  const value =
    side === 'base'
      ? conflict.baseValue
      : side === 'local'
        ? conflict.localValue
        : conflict.remoteValue;
  const index = createDefinitionIndex(definition);
  if (conflict.kind === 'row-delete-edit') {
    if (value === undefined || !isRecord(value) || !isRecord(value['values'])) return 'Row removed';
    const parts = Object.entries(value['values']).flatMap(([componentId, fieldValue]) => {
      const component = index.components.get(componentId)?.component ?? null;
      if (component == null) return [];
      return [`${component.label?.trim() || componentId}: ${formatAnswer(component, fieldValue, options)}`];
    });
    return parts.length > 0 ? parts.join(' · ') : 'Empty row';
  }
  if (value === undefined) return 'Removed';
  return formatAnswer(index.components.get(conflict.componentId)?.component ?? null, value, options);
}

function formatAnswer(
  component: FormComponent | null,
  value: unknown,
  options: DraftConflictFormatOptions,
): string {
  if (value == null || value === '') return 'Not provided';
  const type = component?.type ?? '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if ((type === 'select' || type === 'radio') && typeof value === 'string')
    return optionLabel(component, value);
  if (type === 'checkboxGroup' && Array.isArray(value))
    return value.map((item) => optionLabel(component, String(item))).join(', ') || 'Not provided';
  if (
    isRecord(value) &&
    typeof value['last4'] === 'string' &&
    (value['kind'] === 'ssn' || value['kind'] === 'itin' || value['kind'] === 'ein')
  )
    return maskTaxId(value['last4'], value['kind'] as TaxIdentifierKind);
  if (Array.isArray(value) && value.every((item) => isRecord(item) && typeof item['fileId'] === 'string')) {
    if (value.length === 0) return 'No files';
    return value
      .map((item) => {
        const fileId = String((item as Record<string, unknown>)['fileId']);
        return options.fileName?.(fileId)?.trim() || 'File';
      })
      .join(', ');
  }
  if ((type === 'number' || type === 'currency') && typeof value === 'string' && /^-?[0-9]+(\.[0-9]+)?$/.test(value))
    return `${type === 'currency' ? '$' : ''}${groupDigits(value)}`;
  if (type === 'address' && isRecord(value))
    return (
      ['line1', 'line2', 'city', 'state', 'postalCode']
        .map((key) => value[key])
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .join(', ') || 'Not provided'
    );
  if (Array.isArray(value)) return value.map((item) => formatAnswer(null, item, options)).join(', ');
  if (isRecord(value))
    return (
      Object.values(value)
        .filter((item) => typeof item === 'string' || typeof item === 'number')
        .join(', ') || 'Not provided'
    );
  return String(value);
}

function optionLabel(component: FormComponent | null, value: string): string {
  const options = component?.props?.['options'];
  if (!Array.isArray(options)) return value;
  const match = options.find((option) => isRecord(option) && option['value'] === value);
  return isRecord(match) && typeof match['label'] === 'string' ? match['label'] : value;
}

function groupDigits(value: string): string {
  const [integer, fraction] = value.split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = sign ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fraction == null ? '' : `.${fraction}`}`;
}
