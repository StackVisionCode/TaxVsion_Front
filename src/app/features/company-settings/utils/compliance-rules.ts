import {
  ComplianceForm,
  OfficeCompliance,
  RETENTION_YEARS_MAX,
  RETENTION_YEARS_MIN,
  UpdateOfficeComplianceRequest,
} from '../data-access/company-settings.model';
import { ComplianceField, emailError, normalizePhone, phoneError } from './office-profile-rules';

/**
 * Reglas del cumplimiento de la oficina, espejo de Tenant (`PUT /tenants/current/compliance`): EFIN de 6
 * dígitos, fechas `yyyy-MM-dd` no futuras (revisión ≥ adopción), contacto de incidentes y retención 3–20.
 */

const EFIN_PATTERN = /^\d{6}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Hoy en la zona del navegador, `yyyy-MM-dd` (lo que da un `<input type="date">`). */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Hoy en la zona de la oficina (IANA), `yyyy-MM-dd`; sin zona válida, la del navegador. */
export function todayIsoIn(timeZoneId: string | null | undefined, now: Date = new Date()): string {
  if (!timeZoneId) return todayIso(now);
  try {
    // en-CA formatea como yyyy-MM-dd.
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZoneId, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return todayIso(now);
  }
}

/** "Mark reviewed today": hace falta la fecha de adopción y que la última revisión no sea ya hoy. */
export function canMarkWispReviewedToday(adoptedOn: string, lastReviewedOn: string, today: string): boolean {
  const adopted = adoptedOn.trim();
  return DATE_PATTERN.test(adopted) && adopted <= today && lastReviewedOn.trim() !== today;
}

export function toComplianceForm(c: OfficeCompliance | null): ComplianceForm {
  return {
    efinAction: 'keep',
    efin: '',
    securityCoordinatorUserId: c?.securityCoordinatorUserId ?? '',
    wispAdoptedOn: c?.wispAdoptedOn ?? '',
    wispLastReviewedOn: c?.wispLastReviewedOn ?? '',
    incidentContactEmail: c?.incidentContactEmail ?? '',
    incidentContactPhone: c?.incidentContactPhone ?? '',
    retentionYears: c?.retentionYears != null ? String(c.retentionYears) : '',
  };
}

/** Errores locales por campo (vacío = válido). */
export function complianceErrors(form: ComplianceForm, today: string): Partial<Record<ComplianceField, string>> {
  const errors: Partial<Record<ComplianceField, string>> = {};
  if (form.efinAction === 'change' && !EFIN_PATTERN.test(form.efin.trim())) {
    errors.efin = 'The EFIN must have exactly 6 digits.';
  }
  const adopted = form.wispAdoptedOn.trim();
  const reviewed = form.wispLastReviewedOn.trim();
  if (adopted && (!DATE_PATTERN.test(adopted) || adopted > today)) {
    errors.wispAdoptedOn = 'Use a past date.';
  }
  if (reviewed && (!DATE_PATTERN.test(reviewed) || reviewed > today)) {
    errors.wispLastReviewedOn = 'Use a past date.';
  } else if (reviewed && adopted && reviewed < adopted) {
    errors.wispLastReviewedOn = 'The review can’t be before the adoption date.';
  }
  const email = emailError(form.incidentContactEmail);
  if (email) errors.incidentEmail = email;
  const phone = phoneError(form.incidentContactPhone);
  if (phone) errors.incidentPhone = phone;
  if (form.retentionYears) {
    const years = Number(form.retentionYears);
    if (!Number.isInteger(years) || years < RETENTION_YEARS_MIN || years > RETENTION_YEARS_MAX) {
      errors.retentionYears = `Choose between ${RETENTION_YEARS_MIN} and ${RETENTION_YEARS_MAX} years.`;
    }
  }
  return errors;
}

/** Formulario → PUT. El EFIN solo viaja si se cambia (`"123456"`) o se quita (`""`). */
export function toComplianceRequest(form: ComplianceForm): UpdateOfficeComplianceRequest {
  const request: UpdateOfficeComplianceRequest = {
    securityCoordinatorUserId: form.securityCoordinatorUserId || null,
    wispAdoptedOn: form.wispAdoptedOn.trim() || null,
    wispLastReviewedOn: form.wispLastReviewedOn.trim() || null,
    incidentContactEmail: form.incidentContactEmail.trim() || null,
    incidentContactPhone: normalizePhone(form.incidentContactPhone) || null,
    retentionYears: form.retentionYears ? Number(form.retentionYears) : null,
  };
  if (form.efinAction === 'change') request.efin = form.efin.trim();
  if (form.efinAction === 'clear') request.efin = '';
  return request;
}

/** Hay algo que guardar respecto de lo cargado. */
export function complianceDirty(form: ComplianceForm, loaded: OfficeCompliance | null): boolean {
  if (form.efinAction !== 'keep') return true;
  const saved = toComplianceForm(loaded);
  return (Object.keys(saved) as (keyof ComplianceForm)[]).some(key => form[key].trim() !== saved[key].trim());
}

/**
 * El WISP se revisa al menos una vez al año (FTC Safeguards Rule): vencido si la última revisión (o, sin
 * revisión, la adopción) tiene más de 12 meses.
 */
export function isWispReviewDue(adoptedOn: string | null, lastReviewedOn: string | null, today: string): boolean {
  const reference = (lastReviewedOn || adoptedOn || '').trim();
  if (!DATE_PATTERN.test(reference)) return false;
  const [year, month, day] = reference.split('-').map(Number);
  const due = `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return today > due;
}

/** Campo con error que toca cada clave del formulario (para borrar el 400 del backend al editar). */
export const COMPLIANCE_KEY_FIELD: Record<keyof ComplianceForm, ComplianceField> = {
  efinAction: 'efin',
  efin: 'efin',
  securityCoordinatorUserId: 'securityCoordinator',
  wispAdoptedOn: 'wispAdoptedOn',
  wispLastReviewedOn: 'wispLastReviewedOn',
  incidentContactEmail: 'incidentEmail',
  incidentContactPhone: 'incidentPhone',
  retentionYears: 'retentionYears',
};
