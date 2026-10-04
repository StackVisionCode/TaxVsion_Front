import { FieldType } from '../ui/signature-request-panel/signature-wizard.model';
import { NormalizedRect, PageSize, denormalizeFieldRect, normalizeFieldRect } from './field-normalize.util';

/**
 * Lógica pura del editor de plantillas (`ui/signature-template-editor`): conversión del layout
 * local (px de pantalla) al payload normalizado, validación de publicación por rol, reescalado al
 * cambiar de superficie/zoom, duplicado y conservación del layout sin guardar tras recargar.
 *
 * Todo trabaja con px a la escala actual de la página renderizada; la normalización la hace
 * SIEMPRE `normalizeFieldRect` (la única implementación del formato que exige el backend).
 */

/** slotOrder sentinela para los campos del PREPARADOR (los slots reales son >= 1). */
export const PREPARER_SLOT = 0;

/** Tamaño mínimo de un campo en px de pantalla. */
export const MIN_FIELD_W = 48;
export const MIN_FIELD_H = 28;

/** Campo colocado sobre la superficie de layout (px de pantalla a la escala actual). */
export interface TemplateFieldLocal {
  localId: string;
  slotOrder: number;
  type: FieldType;
  /** 1-based. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Instrucción/etiqueta que verá el firmante (solo `text`). */
  label?: string;
}

/** Página de la superficie: número 1-based + tamaño en px a la escala actual. */
export interface LayoutPage extends PageSize {
  page: number;
}

/** Slot mínimo que necesitan estas funciones (subconjunto de TemplateSlotResponse). */
export interface LayoutSlot {
  id: string;
  order: number;
  role: string;
}

export interface NormalizedSignerField extends NormalizedRect {
  slotOrder: number;
  type: FieldType;
  page: number;
  label?: string;
}

export interface NormalizedPreparerField extends NormalizedRect {
  type: FieldType;
  page: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function isPreparerSlot(slotOrder: number): boolean {
  return slotOrder === PREPARER_SLOT;
}

// ---------------------------------------------------------------------------
// Payload (misma salida exacta que la copia anterior del componente)
// ---------------------------------------------------------------------------

/** Campos de firmante en coordenadas normalizadas [0..1]; los del preparador se excluyen. */
export function buildNormalizedSignerFields(
  fields: readonly TemplateFieldLocal[],
  pages: readonly LayoutPage[],
): NormalizedSignerField[] {
  const out: NormalizedSignerField[] = [];
  for (const field of fields) {
    if (isPreparerSlot(field.slotOrder)) {
      continue; // los del preparador se persisten aparte
    }
    const rect = normalizeFieldRect(field, pages.find(p => p.page === field.page));
    if (!rect) {
      continue;
    }
    out.push({
      slotOrder: field.slotOrder,
      type: field.type,
      page: field.page,
      ...rect,
      label: field.type === 'text' ? field.label?.trim() || undefined : undefined,
    });
  }
  return out;
}

/** Campos del preparador normalizados [0..1] (solo los del slot sentinela). */
export function buildNormalizedPreparerFields(
  fields: readonly TemplateFieldLocal[],
  pages: readonly LayoutPage[],
): NormalizedPreparerField[] {
  const out: NormalizedPreparerField[] = [];
  for (const field of fields) {
    if (!isPreparerSlot(field.slotOrder)) {
      continue;
    }
    const rect = normalizeFieldRect(field, pages.find(p => p.page === field.page));
    if (rect) {
      out.push({ type: field.type, page: field.page, ...rect });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validación de publicación
// ---------------------------------------------------------------------------

/**
 * Roles firmantes SIN un campo de firma o iniciales. Los campos del preparador no cuentan:
 * una plantilla con solo la firma del preparador no sirve para que nadie firme.
 */
export function rolesMissingSignature(
  slots: readonly Pick<LayoutSlot, 'order' | 'role'>[],
  fields: readonly Pick<TemplateFieldLocal, 'slotOrder' | 'type'>[],
): string[] {
  const signed = new Set(
    fields
      .filter(f => !isPreparerSlot(f.slotOrder) && (f.type === 'signature' || f.type === 'initials'))
      .map(f => f.slotOrder),
  );
  return [...slots]
    .sort((a, b) => a.order - b.order)
    .filter(s => !signed.has(s.order))
    .map(s => s.role);
}

// ---------------------------------------------------------------------------
// Reescalado (zoom / cambio de superficie)
// ---------------------------------------------------------------------------

/** Lleva una caja de una página a otra conservando su posición relativa (sin redondeo). */
export function rescaleRect<T extends { x: number; y: number; width: number; height: number }>(
  field: T,
  from: PageSize,
  to: PageSize,
): T {
  if (from.width <= 0 || from.height <= 0) {
    return field;
  }
  // Mismo tamaño: sin cuentas, para no introducir ruido de coma flotante.
  if (from.width === to.width && from.height === to.height) {
    return field;
  }
  const relative: NormalizedRect = {
    x: field.x / from.width,
    y: field.y / from.height,
    width: field.width / from.width,
    height: field.height / from.height,
  };
  return { ...field, ...denormalizeFieldRect(relative, to) };
}

/**
 * Reubica los campos proporcionalmente al cambiar la superficie (zoom o PDF nuevo). Si la nueva
 * superficie no tiene la página de un campo, el campo pasa a la página 1 y se cuenta en `moved`
 * para avisar al usuario (antes se movía en silencio).
 */
export function remapFieldsToPages(
  fields: readonly TemplateFieldLocal[],
  prev: readonly LayoutPage[],
  next: readonly LayoutPage[],
): { fields: TemplateFieldLocal[]; moved: number } {
  let moved = 0;
  const out = fields.map(f => {
    const from = prev.find(p => p.page === f.page);
    let to = next.find(p => p.page === f.page);
    if (!to) {
      to = next[0];
      if (to) {
        moved++;
      }
    }
    if (!from || !to) {
      return f;
    }
    // Sin clamp: el reescalado conserva la caja relativa tal cual (mismo payload normalizado).
    const scaled = rescaleRect(f, from, to);
    return scaled === f && f.page === to.page ? f : { ...scaled, page: to.page };
  });
  return { fields: out, moved };
}

/**
 * Mantiene la caja dentro de la página. Sin mínimo por defecto: reescalar o mover no debe cambiar
 * el tamaño relativo (el mínimo solo aplica al redimensionar, escalado por zoom).
 */
export function clampToPage<T extends { x: number; y: number; width: number; height: number }>(
  field: T,
  page: PageSize,
  minW = 0,
  minH = 0,
): T {
  const width = clamp(field.width, Math.min(minW, page.width), page.width);
  const height = clamp(field.height, Math.min(minH, page.height), page.height);
  return {
    ...field,
    width,
    height,
    x: clamp(field.x, 0, page.width - width),
    y: clamp(field.y, 0, page.height - height),
  };
}

// ---------------------------------------------------------------------------
// Edición: mover con teclado, cambiar de página, duplicar
// ---------------------------------------------------------------------------

/** Desplaza un campo dx/dy px sin salirse de su página. */
export function nudgeField(field: TemplateFieldLocal, dx: number, dy: number, page: PageSize): TemplateFieldLocal {
  return clampToPage({ ...field, x: field.x + dx, y: field.y + dy }, page);
}

/** Pasa el campo a otra página manteniendo su posición relativa. */
export function moveFieldToPage(field: TemplateFieldLocal, from: LayoutPage, to: LayoutPage): TemplateFieldLocal {
  return clampToPage({ ...rescaleRect(field, from, to), page: to.page }, to);
}

/** Copia en la misma página, desplazada `offset` px (dentro de la página). Es un campo normal nuevo. */
export function duplicateField(
  field: TemplateFieldLocal,
  page: PageSize,
  localId: string,
  offset = 16,
): TemplateFieldLocal {
  return clampToPage({ ...field, localId, x: field.x + offset, y: field.y + offset }, page);
}

/**
 * Copia el campo a TODAS las demás páginas en la misma posición relativa (p. ej. iniciales en
 * cada hoja). Crea campos normales e independientes; no toca la página de origen.
 */
export function copyFieldToAllPages(
  field: TemplateFieldLocal,
  pages: readonly LayoutPage[],
  nextId: () => string,
): TemplateFieldLocal[] {
  const from = pages.find(p => p.page === field.page);
  if (!from) {
    return [];
  }
  return pages
    .filter(p => p.page !== field.page)
    .map(to => ({ ...moveFieldToPage(field, from, to), localId: nextId() }));
}

// ---------------------------------------------------------------------------
// Conservar el layout sin guardar tras recargar el detalle
// ---------------------------------------------------------------------------

/**
 * Tras una acción que recarga el detalle (detalles, roles, PIN…), re-aplica el layout local sin
 * guardar sobre los slots nuevos. El backend puede renumerar los `order` (p. ej. al quitar un rol),
 * así que se traduce por `slot.id`: los campos de un rol que ya no existe se descartan (el server
 * también los borró); los del preparador se conservan tal cual.
 */
export function preserveLocalLayout(
  local: readonly TemplateFieldLocal[],
  oldSlots: readonly Pick<LayoutSlot, 'id' | 'order'>[],
  newSlots: readonly Pick<LayoutSlot, 'id' | 'order'>[],
): TemplateFieldLocal[] {
  const idByOldOrder = new Map(oldSlots.map(s => [s.order, s.id]));
  const newOrderById = new Map(newSlots.map(s => [s.id, s.order]));
  const out: TemplateFieldLocal[] = [];
  for (const field of local) {
    if (isPreparerSlot(field.slotOrder)) {
      out.push(field);
      continue;
    }
    const slotId = idByOldOrder.get(field.slotOrder);
    const order = slotId !== undefined ? newOrderById.get(slotId) : undefined;
    if (order !== undefined) {
      out.push(order === field.slotOrder ? field : { ...field, slotOrder: order });
    }
  }
  return out;
}

/** Mayor sufijo numérico de ids `f-N` (para que el contador local no repita ids). */
export function maxLocalSeq(fields: readonly Pick<TemplateFieldLocal, 'localId'>[]): number {
  let max = -1;
  for (const f of fields) {
    const match = /^f-(\d+)$/.exec(f.localId);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return max;
}
