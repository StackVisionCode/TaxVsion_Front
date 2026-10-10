import {
  EditorSigner,
  FieldType,
  PREPARER_PARTY_ID,
  PlacedField,
} from '../ui/signature-request-panel/signature-wizard.model';
import { denormalizeFieldRect, normalizeFieldRect } from './field-normalize.util';

/**
 * Operaciones PURAS sobre los campos del editor de firma (px de la página renderizada, origen
 * arriba-izquierda). Sin Angular: el editor de solicitudes las usa y el de plantillas puede
 * reutilizarlas (sus campos tienen la misma forma x/y/width/height/page).
 *
 * - `rescaleFields(fields, ratio)` ......... reescala por un ratio uniforme.
 * - `rescaleFieldsBetweenPages(f, old, new)` reescala al cambiar de zoom (solo tras un render OK).
 * - `scaleSize(size, zoom)` ................ tamaños por defecto/mínimos en px de pantalla al zoom actual.
 * - `clampToPage(field, page)` ............. mete la caja dentro de la página.
 * - `nudgeField(field, dx, dy, page)` ...... mover con flechas (clamp a la página).
 * - `duplicateFieldRect(field, page, id)` .. copia desplazada en la misma página.
 * - `copyFieldToAllPages(field, pages, newId)` copia a las demás páginas, misma posición relativa.
 * - `reassignSignerFields(fields, from, to, newId)` pasa campos a otro firmante con ids nuevos.
 * - `remapFieldsToPages(fields, oldPages, newPages)` conserva campos al cambiar de documento.
 * - `signersMissingSignature(signers, fields)` firmantes sin Firma/Iniciales (el preparador no cuenta).
 */

export interface PageBox {
  page: number;
  width: number;
  height: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Desplazamiento (px) de una copia respecto del original al duplicar. */
export const DUPLICATE_OFFSET = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Reescala posición y tamaño por `ratio` (nuevaEscala / escalaAnterior). */
export function rescaleFields<T extends PlacedField>(fields: T[], ratio: number): T[] {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) {
    return fields;
  }
  return fields.map((f) => ({
    ...f,
    x: f.x * ratio,
    y: f.y * ratio,
    width: f.width * ratio,
    height: f.height * ratio,
  }));
}

/**
 * Reescala cada campo de su página vieja a la misma página re-renderizada (ancho y alto por
 * separado, sin redondeos): la posición relativa queda EXACTAMENTE igual aunque el render redondee
 * el tamaño de la página. Es lo que usa el zoom tras un render correcto.
 */
export function rescaleFieldsBetweenPages<T extends PlacedField>(
  fields: T[],
  oldPages: PageBox[],
  newPages: PageBox[],
): T[] {
  return fields.map((f) => {
    const from = oldPages.find((p) => p.page === f.page);
    const to = newPages.find((p) => p.page === f.page);
    if (!from || !to || from.width <= 0 || from.height <= 0) {
      return f;
    }
    const rx = to.width / from.width;
    const ry = to.height / from.height;
    return { ...f, x: f.x * rx, width: f.width * rx, y: f.y * ry, height: f.height * ry };
  });
}

/**
 * Tamaño en px de pantalla al zoom actual. Las constantes de tamaño están pensadas para zoom 1:
 * sin escalar, un campo creado a 60% quedaba proporcionalmente más grande en el PDF que a 200%.
 */
export function scaleSize(size: Size, zoom: number): Size {
  return { w: size.w * zoom, h: size.h * zoom };
}

/** Recorta la caja para que quepa dentro de la página (posición y, si hace falta, tamaño). */
export function clampToPage<T extends PlacedField>(field: T, page: PageBox): T {
  const width = Math.min(field.width, page.width);
  const height = Math.min(field.height, page.height);
  return {
    ...field,
    width,
    height,
    x: clamp(field.x, 0, page.width - width),
    y: clamp(field.y, 0, page.height - height),
  };
}

export function nudgeField<T extends PlacedField>(
  field: T,
  dx: number,
  dy: number,
  page: PageBox,
): T {
  return clampToPage({ ...field, x: field.x + dx, y: field.y + dy }, page);
}

/** Copia en la misma página, desplazada; si no cabe abajo-derecha, se desplaza arriba-izquierda. */
export function duplicateFieldRect<T extends PlacedField>(field: T, page: PageBox, id: string): T {
  const fitsForward =
    field.x + DUPLICATE_OFFSET + field.width <= page.width &&
    field.y + DUPLICATE_OFFSET + field.height <= page.height;
  const offset = fitsForward ? DUPLICATE_OFFSET : -DUPLICATE_OFFSET;
  return clampToPage({ ...field, id, x: field.x + offset, y: field.y + offset }, page);
}

/**
 * Copia el campo a TODAS las demás páginas en la misma posición relativa (normalizada), así una
 * página de distinto tamaño recibe la caja en el mismo sitio proporcional. Crea campos normales
 * (cada uno con su id), no un campo "multi-página".
 */
export function copyFieldToAllPages<T extends PlacedField>(
  field: T,
  pages: PageBox[],
  newId: () => string,
): T[] {
  const source = pages.find((p) => p.page === field.page);
  if (!source) {
    return [];
  }
  const rel = {
    x: field.x / source.width,
    y: field.y / source.height,
    width: field.width / source.width,
    height: field.height / source.height,
  };
  return pages
    .filter((p) => p.page !== field.page)
    .map((p) =>
      clampToPage({ ...field, id: newId(), page: p.page, ...denormalizeFieldRect(rel, p) }, p),
    );
}

/**
 * Pasa los campos de `fromSignerId` a `toSignerId` con ids NUEVOS. Ids nuevos a propósito: en un
 * borrador rehidratado los campos ya publicados se saltan por localId, así que conservar el id
 * dejaría el campo pegado al firmante viejo en el backend (o perdido si ese firmante se borra).
 * Con id nuevo, el diff del borrador borra el viejo y publica el nuevo; en creación da igual.
 */
export function reassignSignerFields<T extends PlacedField>(
  fields: T[],
  fromSignerId: string,
  toSignerId: string,
  newId: () => string,
): T[] {
  if (fromSignerId === toSignerId) {
    return fields;
  }
  return fields.map((f) =>
    f.signerId === fromSignerId ? { ...f, id: newId(), signerId: toSignerId } : f,
  );
}

/**
 * Conserva los campos al cambiar a un documento nuevo: cada caja se lleva a la misma posición
 * relativa de su página en el documento nuevo. Los campos de páginas que ya no existen se descartan
 * (se devuelven en `dropped` para poder avisar).
 */
export function remapFieldsToPages<T extends PlacedField>(
  fields: T[],
  oldPages: PageBox[],
  newPages: PageBox[],
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const field of fields) {
    const from = oldPages.find((p) => p.page === field.page);
    const to = newPages.find((p) => p.page === field.page);
    const rel = from ? normalizeFieldRect(field, from) : null;
    if (!to || !rel) {
      dropped.push(field);
      continue;
    }
    kept.push(clampToPage({ ...field, ...denormalizeFieldRect(rel, to) }, to));
  }
  return { kept, dropped };
}

export function isSigningFieldType(type: FieldType): boolean {
  return type === 'signature' || type === 'initials';
}

/**
 * Firmantes que todavía no tienen ningún campo de Firma o Iniciales. Los campos del preparador
 * (PREPARER_PARTY_ID) NO cuentan: antes inflaban el conteo y "Next" pasaba mientras "Send" quedaba
 * deshabilitado sin explicación.
 */
export function signersMissingSignature(
  signers: EditorSigner[],
  fields: PlacedField[],
): EditorSigner[] {
  const covered = new Set(
    fields
      .filter((f) => f.signerId !== PREPARER_PARTY_ID && isSigningFieldType(f.type))
      .map((f) => f.signerId),
  );
  return signers.filter((s) => s.id !== PREPARER_PARTY_ID && !covered.has(s.id));
}

/**
 * Documentos que todavía no tienen una firma o iniciales de un firmante real. Mantiene en el
 * frontend la misma invariante que `SignatureRequest.ValidateDocumentsForSend()` aplica al enviar:
 * una firma del preparador no convierte por sí sola al documento en firmable.
 */
export function documentsMissingSigningField<T extends { id: string }>(
  documents: readonly T[],
  fields: readonly PlacedField[],
): T[] {
  const covered = new Set(
    fields
      .filter((field) => field.signerId !== PREPARER_PARTY_ID && isSigningFieldType(field.type))
      .map((field) => field.documentLocalId),
  );
  return documents.filter((document) => !covered.has(document.id));
}

/** Campos que pertenecen a firmantes reales (excluye los del preparador). */
export function signerFieldCount(fields: PlacedField[]): number {
  return fields.filter((f) => f.signerId !== PREPARER_PARTY_ID).length;
}
