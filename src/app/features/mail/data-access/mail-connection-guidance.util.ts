import { ManualConnectionCheck } from './mail.model';

/** Qué hacer ante un fallo de "Test connection", en palabras del usuario y con el enlace del proveedor. */
export interface ConnectionGuidance {
  text: string;
  link: { label: string; url: string } | null;
}

/** Páginas oficiales de "app password" (verificadas); Microsoft y Zoho van solo con texto. */
const APP_PASSWORD_HELP: Readonly<Record<string, { label: string; url: string }>> = {
  gmail: { label: 'How to create a Google app password', url: 'https://support.google.com/accounts/answer/185833' },
  yahoo: { label: 'How to create a Yahoo app password', url: 'https://help.yahoo.com/kb/SLN15241.html' },
  icloud: { label: 'How to create an iCloud app-specific password', url: 'https://support.apple.com/en-us/102654' },
};

/**
 * Traduce el código del backend (`…ImapAuthFailed`, `…SmtpUnreachable`, `…TlsFailed`) a qué revisar.
 * `providerId` es la opción del formulario manual (gmail, yahoo, office365, …). null = sin consejo extra:
 * el mensaje del servidor ya basta.
 */
export function connectionGuidance(
  check: ManualConnectionCheck,
  server: 'imap' | 'smtp',
  providerId: string,
): ConnectionGuidance | null {
  const code = check.errorCode ?? '';
  if (check.ok || !code) {
    return null;
  }
  if (code.endsWith('AuthFailed')) {
    return authGuidance(providerId);
  }
  if (code.endsWith('TlsFailed')) {
    return {
      text:
        server === 'imap'
          ? 'Incoming mail usually uses port 993 with SSL/TLS on.'
          : 'Outgoing mail usually uses port 587 with STARTTLS on, or port 465 with STARTTLS off.',
      link: null,
    };
  }
  return null;
}

function authGuidance(providerId: string): ConnectionGuidance {
  switch (providerId) {
    case 'gmail':
      return {
        text: 'Gmail needs an app password when 2-Step Verification is on. Use it instead of your regular password.',
        link: APP_PASSWORD_HELP['gmail'],
      };
    case 'yahoo':
      return { text: 'Yahoo Mail needs an app password for email apps.', link: APP_PASSWORD_HELP['yahoo'] };
    case 'icloud':
      return { text: 'iCloud Mail needs an app-specific password for email apps.', link: APP_PASSWORD_HELP['icloud'] };
    case 'office365':
      return {
        text: 'Microsoft 365 can block password sign-in for email apps. Ask your admin to allow it, or go back and use Connect Microsoft 365.',
        link: null,
      };
    case 'zoho':
      return { text: 'If two-factor authentication is on, Zoho needs an application-specific password.', link: null };
    default:
      return { text: 'Check the password. Some providers need an app password instead of your regular one.', link: null };
  }
}
