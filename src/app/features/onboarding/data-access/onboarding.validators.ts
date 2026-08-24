import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Espejos client-side de las reglas que el backend ya aplica. Existen para dar
 * feedback inmediato, no para reemplazar la validación real: el servidor sigue
 * siendo la autoridad y sus mensajes se muestran tal cual cuando rechaza algo.
 */

// ── Subdominio ───────────────────────────────────────────────────────────────
// Espejo de TaxVision.Auth.Domain.TenantDomains.SubdomainSlug.Create.

/** Etiqueta DNS: minúsculas/dígitos/guiones, sin guion inicial ni final. */
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

export const SUBDOMAIN_MIN_LENGTH = 3;
export const SUBDOMAIN_MAX_LENGTH = 63;

/** Subdominios de sistema/branding que ninguna oficina puede reclamar. */
const RESERVED_SUBDOMAINS = new Set([
  'www', 'www2', 'api', 'admin', 'administrator', 'app', 'apps', 'auth', 'login',
  'account', 'accounts', 'billing', 'mail', 'smtp', 'pop', 'imap', 'ftp', 'cdn',
  'assets', 'static', 'blog', 'help', 'support', 'docs', 'status', 'dashboard',
  'portal', 'dev', 'staging', 'test', 'beta', 'demo', 'secure', 'ssl', 'ns',
  'ns1', 'ns2', 'mx', 'email', 'webmail', 'cpanel', 'root', 'system', 'internal',
  'api-docs', 'oauth', 'sso', 'id', 'files', 'media', 'img', 'images', 'turn',
  'platform', 'platform-internal',
]);

/** Devuelve el código de error del backend, o null si el slug es válido de forma. */
export function validateSubdomainSlug(value: string): string | null {
  const normalized = value.trim().toLowerCase();

  if (normalized.length < SUBDOMAIN_MIN_LENGTH || normalized.length > SUBDOMAIN_MAX_LENGTH) {
    return 'TenantDomain.SlugLength';
  }
  if (normalized.startsWith('xn--')) {
    return 'TenantDomain.SlugInvalid';
  }
  if (!DNS_LABEL.test(normalized)) {
    return 'TenantDomain.SlugInvalid';
  }
  if (RESERVED_SUBDOMAINS.has(normalized)) {
    return 'TenantDomain.SlugReserved';
  }
  return null;
}

export const subdomainValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value as string | null;
  if (!value) {
    return null; // `required` se encarga del vacío.
  }
  const code = validateSubdomainSlug(value);
  return code ? { subdomain: code } : null;
};

// ── Contraseña ───────────────────────────────────────────────────────────────
// Espejo de TaxVision.Auth.Application.Common.PasswordPolicy (NIST 800-63B:
// longitud, sin reglas de composición arbitrarias).

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Misma lista literal que PasswordPolicy.CommonPasswords. */
const COMMON_PASSWORDS = new Set([
  'password1234', '123456789012', 'qwerty123456', 'letmein12345', 'administrator',
  'welcome12345', 'iloveyou1234', 'changeme1234', 'password12345', '1234567890ab',
  'abc123456789', 'temporal12345',
]);

export const passwordPolicyValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value as string | null;
  if (!value) {
    return null;
  }
  if (value.length < PASSWORD_MIN_LENGTH) {
    return { passwordPolicy: `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return { passwordPolicy: `Password must not exceed ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    return { passwordPolicy: 'That password is too common.' };
  }
  return null;
};
