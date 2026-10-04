import {
  RequestRules,
  VerificationChannel,
} from '../ui/signature-request-panel/signature-wizard.model';

/**
 * Transformaciones PURAS de las reglas de la solicitud (`RequestRules`). Antes vivían como métodos
 * del editor de campos; al mover la edición de reglas al paso Review se extrajeron sin cambiar
 * ni una regla: mismos valores, mismo payload (el panel sigue leyendo el mismo objeto).
 */

// 'certificate' ya no se alterna: el certificado se genera siempre (generateCertificate = true).
export type ToggleableRule = 'autoReminder' | 'sendSignedDocument' | 'sendCertificate';

export function withSequential(rules: RequestRules, sequential: boolean): RequestRules {
  return { ...rules, sequential };
}

/** Canal por defecto para firmantes NUEVOS: se guarda como primer (y único) elemento de `channels`. */
export function withDefaultChannel(
  rules: RequestRules,
  channel: VerificationChannel,
): RequestRules {
  return { ...rules, channels: [channel] };
}

/** Intervalo de recordatorio en DÍAS (deriva de las horas del modelo). */
export function reminderIntervalDays(rules: RequestRules): number {
  return Math.max(1, Math.round(rules.reminderIntervalHours / 24));
}

/** Fija el intervalo desde el input en días (1..30); persiste en horas. */
export function withReminderIntervalDays(rules: RequestRules, days: number): RequestRules {
  const clamped = Math.min(30, Math.max(1, Math.round(days) || 1));
  return { ...rules, reminderIntervalHours: clamped * 24 };
}

export function toggleRule(rules: RequestRules, key: ToggleableRule): RequestRules {
  // Entregar el certificado exige que se genere. Solo pasa en un borrador viejo creado sin certificado
  // (GenerateCertificate es inmutable; SetCertificateDelivery(true) fallaría): ahí no se puede activar.
  if (key === 'sendCertificate' && !rules.certificate) {
    return rules;
  }
  return { ...rules, [key]: !rules[key] };
}

/** Practitioner PIN (Form 8879): solo dígitos, máx 10; vacío = sin PIN (null). El backend exige 4–10. */
export function withSigningPin(rules: RequestRules, value: string): RequestRules {
  const digits = (value ?? '').replace(/\D/g, '').slice(0, 10);
  return { ...rules, signingPin: digits.length > 0 ? digits : null };
}

/** true si hay un PIN escrito pero con longitud inválida (1–3 dígitos). */
export function isSigningPinInvalid(rules: RequestRules | null | undefined): boolean {
  const pin = rules?.signingPin ?? '';
  return pin.length > 0 && pin.length < 4;
}
