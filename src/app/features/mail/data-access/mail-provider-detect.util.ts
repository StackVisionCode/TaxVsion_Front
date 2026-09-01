import { MailProviderCode } from './mail.model';

/**
 * Detección de proveedor a partir del dominio del email de LOGIN del usuario (el backend no la
 * ofrece — confirmado en la auditoría). Guía la UX de "Connect a mailbox": recomienda OAuth cuando
 * el dominio es de un proveedor conocido con OAuth (Gmail/Microsoft), y precarga host/puerto IMAP+SMTP
 * cuando el proveedor es conocido pero sin OAuth (Yahoo, iCloud, Zoho, etc.). Dominios de negocio no
 * mapeados quedan como 'Unknown': se ofrecen las tres opciones sin adivinar (Google Workspace y M365
 * usan dominios propios y no se pueden distinguir solo por el dominio).
 */

/** Ajustes IMAP+SMTP para prellenar el formulario manual (el usuario aún teclea su contraseña). */
export interface ImapSmtpPreset {
  imapHost: string;
  imapPort: number;
  imapUseSsl: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUseStartTls: boolean;
}

/** 'Unknown' = no se pudo inferir; el resto refleja un proveedor conocido. */
export type DetectedProvider = MailProviderCode | 'Unknown';

export interface ProviderDetection {
  /** Proveedor inferido del dominio. */
  provider: DetectedProvider;
  /** Método recomendado: OAuth (Gmail/Graph) o alta manual IMAP/SMTP. */
  recommendedMethod: 'oauth' | 'manual';
  /** Nombre legible para la UI ("Gmail", "Microsoft 365", "Yahoo Mail", …). */
  label: string;
  /** Preset IMAP/SMTP cuando el proveedor es conocido pero sin OAuth; null en otro caso. */
  imapPreset: ImapSmtpPreset | null;
}

const OFFICE365_PRESET: ImapSmtpPreset = {
  imapHost: 'outlook.office365.com',
  imapPort: 993,
  imapUseSsl: true,
  smtpHost: 'smtp.office365.com',
  smtpPort: 587,
  smtpUseStartTls: true,
};

const GMAIL_PRESET: ImapSmtpPreset = {
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapUseSsl: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpUseStartTls: true,
};

const YAHOO_PRESET: ImapSmtpPreset = {
  imapHost: 'imap.mail.yahoo.com',
  imapPort: 993,
  imapUseSsl: true,
  smtpHost: 'smtp.mail.yahoo.com',
  smtpPort: 587,
  smtpUseStartTls: true,
};

const ICLOUD_PRESET: ImapSmtpPreset = {
  imapHost: 'imap.mail.me.com',
  imapPort: 993,
  imapUseSsl: true,
  smtpHost: 'smtp.mail.me.com',
  smtpPort: 587,
  smtpUseStartTls: true,
};

const ZOHO_PRESET: ImapSmtpPreset = {
  imapHost: 'imap.zoho.com',
  imapPort: 993,
  imapUseSsl: true,
  smtpHost: 'smtp.zoho.com',
  smtpPort: 587,
  smtpUseStartTls: true,
};

/** Preset genérico neutro para 'Unknown' — el usuario completa host/puerto de su proveedor. */
export const GENERIC_MANUAL_PRESET: ImapSmtpPreset = {
  imapHost: '',
  imapPort: 993,
  imapUseSsl: true,
  smtpHost: '',
  smtpPort: 587,
  smtpUseStartTls: true,
};

/** Dominios de consumidor con OAuth: la vía recomendada es el flujo OAuth, sin tocar IMAP/SMTP. */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
const MICROSOFT_DOMAINS = new Set([
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'outlook.es',
  'hotmail.es',
  'live.com.mx',
  'hotmail.com.mx',
  'outlook.com.mx',
]);

/** Dominios de consumidor conocidos SIN OAuth propio acá → alta manual con preset. */
const YAHOO_DOMAINS = new Set(['yahoo.com', 'yahoo.es', 'yahoo.com.mx', 'ymail.com', 'rocketmail.com']);
const ICLOUD_DOMAINS = new Set(['icloud.com', 'me.com', 'mac.com']);
const ZOHO_DOMAINS = new Set(['zoho.com', 'zohomail.com']);

/** Extrae el dominio en minúsculas del email (o null si no parece un email). */
export function domainOf(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) {
    return null;
  }
  return email.slice(at + 1).trim().toLowerCase();
}

export function detectProvider(email: string | null | undefined): ProviderDetection {
  const domain = domainOf(email);

  if (domain && GMAIL_DOMAINS.has(domain)) {
    return { provider: 'Gmail', recommendedMethod: 'oauth', label: 'Gmail', imapPreset: GMAIL_PRESET };
  }
  if (domain && MICROSOFT_DOMAINS.has(domain)) {
    return { provider: 'Graph', recommendedMethod: 'oauth', label: 'Microsoft 365', imapPreset: OFFICE365_PRESET };
  }
  if (domain && YAHOO_DOMAINS.has(domain)) {
    return { provider: 'Imap', recommendedMethod: 'manual', label: 'Yahoo Mail', imapPreset: YAHOO_PRESET };
  }
  if (domain && ICLOUD_DOMAINS.has(domain)) {
    return { provider: 'Imap', recommendedMethod: 'manual', label: 'iCloud Mail', imapPreset: ICLOUD_PRESET };
  }
  if (domain && ZOHO_DOMAINS.has(domain)) {
    return { provider: 'Imap', recommendedMethod: 'manual', label: 'Zoho Mail', imapPreset: ZOHO_PRESET };
  }

  // Dominio de negocio (o desconocido): no se puede inferir Google Workspace vs M365 vs IMAP.
  return { provider: 'Unknown', recommendedMethod: 'manual', label: 'your email provider', imapPreset: null };
}
