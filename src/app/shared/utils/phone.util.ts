/**
 * Teléfonos: normalización al formato del backend y presentación.
 *
 * Movido tal cual desde `features/clients/utils/customer-form-normalizers.ts` (que re-exporta estas
 * funciones para no romper a nadie). Replica el Value Object `PhoneNumber.cs` de Customer:
 * Create(raw) descarta todo salvo '+' y dígitos, luego exige ^\+[1-9]\d{6,14}$ (E.164 estricto).
 * No auto-agrega país: sin '+' se rechaza. Canónico = E.164.
 */

export const E164_REGEX = /^\+[1-9]\d{6,14}$/;

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
