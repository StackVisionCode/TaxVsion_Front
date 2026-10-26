import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type {
  FormComponent,
  FormDefinition,
  FormSection,
} from '@shared/utils/data-collection/form-definition.model';
import { maskTaxId } from '@shared/utils/data-collection/formats';
import { isRecord } from '@shared/utils/data-collection/properties';
import { readRows } from '@shared/utils/data-collection/visibility';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import type { StatusTone } from '@shared/ui/status-pill/status-pill.component';
import type {
  DataCollectionAttachment,
  DataCollectionFieldComment,
} from '@shared/ui/data-collection/data-collection.models';
import { optionsOf } from '@shared/ui/data-collection/data-collection.utils';

/**
 * Formato compartido de la revisión de formularios (drawers del perfil y de la bandeja).
 * La fecha límite es una fecha de calendario: se guarda como medianoche UTC y se muestra en UTC,
 * porque en hora local de EE. UU. el 15 de noviembre saldría como 14.
 */

const DUE_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};

export function formatDueDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = DUE_DATE_FORMAT,
): string {
  const parsed = parseUtcDateOrNull(value);
  return parsed ? parsed.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' }) : '';
}

/** Valor para `<input type="date">`: el día UTC guardado, no el local. */
export function dueDateInputValue(value: string | null | undefined): string {
  return parseUtcDateOrNull(value)?.toISOString().slice(0, 10) ?? '';
}

export function dueDateToUtc(date: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : null;
}

/** Primer día cuya medianoche UTC todavía es futura (el backend exige fecha futura). */
export function earliestDueDate(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
    .toISOString()
    .slice(0, 10);
}

/** Instantes (envíos, actividad): sí van en hora local. */
export function formatReviewDate(value: string | null | undefined): string {
  return (
    parseUtcDateOrNull(value)?.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) ?? ''
  );
}

export function formatReviewDateTime(value: string): string {
  return (
    parseUtcDateOrNull(value)?.toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }) ?? value
  );
}

export function humanizeAction(value: string): string {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());
}

export function reviewStatusLabel(status: string): string {
  return status === 'Submitted' ? 'Needs review' : status;
}

/** Completed y Cancelled son terminales (§42): Cancel y Archive solo valen con la request abierta. */
export function isOpenReviewStatus(status: string): boolean {
  return status === 'Pending' || status === 'Submitted' || status === 'Returned';
}

/** El backend solo cambia la fecha mientras el participante puede editar (`EnsureEditable`). */
export function canChangeReviewDueDate(status: string): boolean {
  return status === 'Pending' || status === 'Returned';
}

export function reviewStatusTone(status: string): StatusTone {
  if (status === 'Completed') return 'success';
  if (status === 'Submitted') return 'warning';
  if (status === 'Returned') return 'info';
  if (status === 'Cancelled') return 'muted';
  return 'neutral';
}

export function findReviewComponent(
  definition: FormDefinition | null | undefined,
  componentId: string,
): { component: FormComponent; section: FormSection } | null {
  for (const page of definition?.pages ?? [])
    for (const section of page.sections) {
      const component = section.components.find((item) => item.id === componentId);
      if (component) return { component, section };
    }
  return null;
}

/** Etiqueta de fila de un repeater ("Dependent 2"), buscando la fila en las respuestas dadas. */
export function reviewRowLabel(
  section: FormSection | null | undefined,
  rowId: string,
  answers: readonly (FormAnswers | null | undefined)[],
): string {
  const label = section?.repeat?.rowLabel || 'Row';
  for (const item of answers) {
    if (!item || !section) continue;
    const index = readRows(item, section.id).findIndex((row) => row.rowId === rowId);
    if (index >= 0) return `${label} ${index + 1}`;
  }
  return label;
}

/**
 * Valor legible de una respuesta. Nunca devuelve JSON: el taxId sale enmascarado con `last4`
 * (jamás `sensitiveRef`), la dirección en una línea y los archivos por nombre.
 */
export function formatAnswerValue(
  component: FormComponent | null | undefined,
  value: unknown,
  attachments: readonly DataCollectionAttachment[] = [],
): string {
  if (value == null || value === '') return 'Not provided';
  const type = component?.type ?? null;
  if (type === 'taxId' || isTaxIdValue(value)) return maskedTaxId(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (component && (type === 'select' || type === 'radio') && typeof value === 'string')
    return optionsOf(component).find((option) => option.value === value)?.label ?? value;
  if (component && type === 'checkboxGroup' && Array.isArray(value))
    return (
      value
        .map(
          (item) =>
            optionsOf(component).find((option) => option.value === item)?.label ?? String(item),
        )
        .join(', ') || 'Not provided'
    );
  if (type === 'file' || isFileList(value)) return fileNames(value, attachments);
  if (type === 'address' || isAddressValue(value)) return formatAddress(value);
  if (type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return formatDueDate(`${value}T00:00:00Z`);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value))
    return value.map((item) => formatAnswerValue(null, item, attachments)).join(', ') || 'None';
  if (isRecord(value)) {
    const parts = Object.values(value).filter(
      (item): item is string | number => typeof item === 'string' || typeof item === 'number',
    );
    return parts.length ? parts.join(', ') : 'Provided';
  }
  return 'Provided';
}

/** Comentarios por campo a partir del mapa `componentId:rowId → texto` del panel. */
export function fieldCommentsFrom(comments: Readonly<Record<string, string>>): {
  componentId: string;
  rowId: string | null;
  comment: string;
}[] {
  return Object.entries(comments)
    .filter(([, comment]) => comment.trim())
    .map(([key, comment]) => {
      const separator = key.indexOf(':');
      return {
        componentId: key.slice(0, separator),
        rowId: key.slice(separator + 1) || null,
        comment: comment.trim(),
      };
    });
}

export type ReviewFieldComment = DataCollectionFieldComment;

function isTaxIdValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && ('sensitiveRef' in value || 'last4' in value);
}

function maskedTaxId(value: unknown): string {
  if (!isRecord(value)) return 'Hidden';
  const last4 =
    typeof value['last4'] === 'string' && /^\d{4}$/.test(value['last4']) ? value['last4'] : null;
  if (!last4) return 'Hidden';
  const kind = value['kind'];
  return maskTaxId(last4, kind === 'ein' ? 'ein' : kind === 'itin' ? 'itin' : 'ssn');
}

function isFileList(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isRecord(item) && typeof item['fileId'] === 'string')
  );
}

function fileNames(value: unknown, attachments: readonly DataCollectionAttachment[]): string {
  if (!Array.isArray(value) || value.length === 0) return 'No files';
  return value
    .map((item) => {
      const fileId = isRecord(item) && typeof item['fileId'] === 'string' ? item['fileId'] : null;
      return attachments.find((file) => file.fileId === fileId)?.displayName ?? 'File';
    })
    .join(', ');
}

function isAddressValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && ('line1' in value || 'postalCode' in value || 'city' in value);
}

function formatAddress(value: unknown): string {
  if (!isRecord(value)) return 'Not provided';
  const text = (key: string) =>
    typeof value[key] === 'string' && (value[key] as string).trim()
      ? (value[key] as string).trim()
      : null;
  const region = [text('state'), text('postalCode')].filter(Boolean).join(' ');
  return (
    [text('line1'), text('line2'), text('city'), region || null].filter(Boolean).join(', ') ||
    'Not provided'
  );
}
