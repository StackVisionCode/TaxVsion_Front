/**
 * Normalizadores y validadores puros para los formularios de Customer. Cada regla
 * replica EXACTAMENTE el Value Object / handler del backend (no una regex propia más
 * estricta), para que la UI acepte lo que el dominio acepta y envíe lo que espera.
 * Fuentes citadas por función.
 */

/** Longitudes máximas reales (PersonalName.cs, EmailAddress.cs). */
export const NAME_MAX_LENGTH = 80;
export const EMAIL_MAX_LENGTH = 254;
export const COUNTRY_CODE_LENGTH = 2;

// ---------------- Teléfono (PhoneNumber.cs) ----------------
// Create(raw): descarta todo salvo '+' y dígitos, luego exige ^\+[1-9]\d{6,14}$
// (E.164 estricto). No auto-agrega país: sin '+' se rechaza. Canónico = E.164.

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/** Deja solo '+' inicial y dígitos (igual que el VO). NO valida. */
export function normalizePhoneToApi(raw: string | null | undefined): string {
  const cleaned = String(raw ?? '').replace(/[^\d+]/g, '');
  // Solo un '+' y solo al inicio.
  const plus = cleaned.startsWith('+') ? '+' : '';
  return plus + cleaned.replace(/\+/g, '');
}

/** Valida contra el VO. El teléfono es opcional: vacío se considera válido (no se envía). */
export function isValidPhone(raw: string | null | undefined): boolean {
  const value = String(raw ?? '').trim();
  if (value === '') return true;
  return E164_REGEX.test(normalizePhoneToApi(value));
}

/** Formato de presentación. US (+1, 11 dígitos) → "+1 (809) 555-1234"; otros E.164 se muestran tal cual. */
export function formatPhoneForDisplay(e164: string | null | undefined): string {
  const value = String(e164 ?? '');
  if (value === '') return '';
  const digits = value.replace(/\D/g, '');
  if (value.startsWith('+1') && digits.length === 11) {
    const n = digits.slice(1);
    return `+1 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  return value;
}

// ---------------- Email (EmailAddress.cs) ----------------
// Create(raw): trim; rechaza si vacío, len > 254, sin '@', o '@' al inicio/fin.
// Normalizado (para dedupe) = trim.ToLowerInvariant(). Sin regex completa.

/** Trim (lo que el VO persiste como Value). */
export function normalizeEmailToApi(raw: string | null | undefined): string {
  return String(raw ?? '').trim();
}

export function isValidEmail(raw: string | null | undefined): boolean {
  const value = normalizeEmailToApi(raw);
  if (value === '' || value.length > EMAIL_MAX_LENGTH) return false;
  const at = value.indexOf('@');
  return at > 0 && at < value.length - 1;
}

// ---------------- Tax identifier (SetCustomerFiscalProfileHandler.cs) ----------------
// No hay VO: se normaliza a solo-dígitos y el SubjectKind decide.
// Individual (SSN/ITIN): 9 dígitos y NO empieza en 000 ni 666.
// Business (EIN): 9 dígitos.

export type FiscalSubjectKind = 'Individual' | 'Business';

/** Solo dígitos (lo que el handler envía tras normalizar). */
export function taxIdentifierDigits(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '');
}

export function isValidTaxIdentifier(raw: string | null | undefined, subjectKind: FiscalSubjectKind): boolean {
  const digits = taxIdentifierDigits(raw);
  if (digits.length !== 9) return false;
  if (subjectKind === 'Individual' && (digits.startsWith('000') || digits.startsWith('666'))) return false;
  return true;
}

/** Presentación SSN "123-45-6789" mientras se escribe. */
export function formatSsnForDisplay(raw: string | null | undefined): string {
  const d = taxIdentifierDigits(raw).slice(0, 9);
  const parts = [d.slice(0, 3), d.slice(3, 5), d.slice(5, 9)].filter(p => p.length > 0);
  return parts.join('-');
}

/** Presentación EIN "12-3456789" mientras se escribe. */
export function formatEinForDisplay(raw: string | null | undefined): string {
  const d = taxIdentifierDigits(raw).slice(0, 9);
  const parts = [d.slice(0, 2), d.slice(2, 9)].filter(p => p.length > 0);
  return parts.join('-');
}

// ---------------- DateOnly (System.Text.Json default) ----------------
// yyyy-MM-dd, SIN conversión de timezone. Un <input type="date"> ya entrega ese formato.

/** Devuelve el yyyy-MM-dd tal cual (o null si vacío). Nunca crea un Date (evita el corrimiento UTC). */
export function serializeDateOnly(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  return v === '' ? null : v;
}

/** True si la fecha (yyyy-MM-dd) es estrictamente futura respecto a hoy (para FormationDate no-futura). */
export function isFutureDate(value: string | null | undefined): boolean {
  const v = serializeDateOnly(value);
  if (v === null) return false;
  return v > todayDateOnly();
}

/** Hoy como yyyy-MM-dd en la zona local (comparación lexicográfica válida para este formato). */
export function todayDateOnly(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

// ---------------- RelationPurpose (RelationPurpose.cs — [Flags] int) ----------------

/** Combina flags seleccionados en el bitmask entero que espera el backend. */
export function purposesToBitmask(bits: readonly number[]): number {
  return bits.reduce((mask, bit) => mask | bit, 0);
}

/** Descompone un bitmask en la lista de flags activos (de un catálogo dado). */
export function bitmaskToPurposes(mask: number, catalog: readonly number[]): number[] {
  return catalog.filter(bit => (mask & bit) === bit && bit !== 0);
}

/** True si el bitmask contiene el flag. */
export function hasPurpose(mask: number, bit: number): boolean {
  return (mask & bit) === bit && bit !== 0;
}
