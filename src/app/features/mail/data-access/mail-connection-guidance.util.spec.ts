import { describe, expect, it } from 'vitest';
import { connectionGuidance } from './mail-connection-guidance.util';
import { ManualConnectionCheck } from './mail.model';

const failed = (code: string): ManualConnectionCheck => ({ ok: false, errorCode: code, message: 'x' });

// Qué revisar ante cada fallo de "Test connection".
describe('connectionGuidance', () => {
  it('no aconseja nada cuando la prueba pasó', () => {
    expect(connectionGuidance({ ok: true, errorCode: null, message: null }, 'imap', 'gmail')).toBeNull();
  });

  it('contraseña rechazada en Gmail: app password con el enlace de Google', () => {
    const guidance = connectionGuidance(failed('ManualAccountConnectivityValidator.ImapAuthFailed'), 'imap', 'gmail');

    expect(guidance?.text).toContain('app password');
    expect(guidance?.link?.url).toBe('https://support.google.com/accounts/answer/185833');
  });

  it('contraseña rechazada en Microsoft 365: sin enlace inventado, sugiere el admin o el OAuth', () => {
    const guidance = connectionGuidance(failed('ManualAccountConnectivityValidator.SmtpAuthFailed'), 'smtp', 'office365');

    expect(guidance?.link).toBeNull();
    expect(guidance?.text).toContain('Connect Microsoft 365');
  });

  it('servidor inalcanzable: el mensaje del servidor ya dice qué revisar, sin repetirlo', () => {
    expect(connectionGuidance(failed('ManualAccountConnectivityValidator.SmtpUnreachable'), 'smtp', 'custom')).toBeNull();
  });

  it('TLS fallido: el puerto y cifrado habituales de cada servidor', () => {
    expect(connectionGuidance(failed('ManualAccountConnectivityValidator.ImapTlsFailed'), 'imap', 'custom')?.text).toContain('993');
    expect(connectionGuidance(failed('ManualAccountConnectivityValidator.SmtpTlsFailed'), 'smtp', 'custom')?.text).toContain('587');
  });

  it('otro fallo: basta el mensaje del servidor', () => {
    expect(connectionGuidance(failed('ManualAccountConnectivityValidator.ImapFailed'), 'imap', 'custom')).toBeNull();
  });
});
