import { defaultRules } from './signature-wizard.presenter';
import { SignatureSettings } from '../../data-access/signature.model';

/**
 * B5 — una solicitud nueva debe PRESELECCIONAR los defaults que el despacho configuró en
 * Settings → Signature, en vez de pisarlos con los hardcodes del wizard. Sin settings, caen a
 * los hardcodes de siempre.
 */
describe('defaultRules — preselección de los defaults del despacho (B5)', () => {
  const firmSettings: SignatureSettings = {
    allowedVerificationChannels: ['Email', 'Sms'],
    defaultVerificationChannel: 'Sms',
    defaultTokenExpirationHours: 72,
    remindersEnabledByDefault: false,
    defaultReminderIntervalHours: 96,
    generateCertificateByDefault: true,
    allowEmployeeOwnSignature: true,
    maxPdfBytes: 10_000_000,
    maxImageBytes: 5_000_000,
    maxPagesPerDocument: 50,
    retentionYears: 7,
    allowPurge: false,
    sendPartialCopyDefault: true,
    partialCopyDefaultAudienceKind: 'Specific',
    sendSealedDocumentDefault: true,
    expirationEnabledByDefault: false,
    sendCertificateToSignersDefault: true,
    requiresConsentByDefault: true,
  };

  it('sin settings cae a los hardcodes históricos', () => {
    const r = defaultRules();
    expect(r.channels).toEqual(['email']);
    expect(r.autoReminder).toBe(true);
    expect(r.reminderIntervalHours).toBe(48);
    expect(r.sendSealedDocument).toBe(false);
    expect(r.sendCertificate).toBe(false);
    expect(r.sendPartialCopy).toBe(false);
    expect(r.partialCopyAudienceKind).toBe('All');
    expect(r.expirationEnabled).toBe(true);
  });

  it('con settings preselecciona canal, entrega, recordatorio, expiración y la audiencia de la copia parcial', () => {
    const r = defaultRules(firmSettings);
    expect(r.channels).toEqual(['sms']); // 'Sms' del despacho → 'sms' de la request
    expect(r.autoReminder).toBe(false);
    expect(r.reminderIntervalHours).toBe(96);
    expect(r.sendSealedDocument).toBe(true);
    expect(r.sendCertificate).toBe(true);
    expect(r.sendPartialCopy).toBe(true);
    expect(r.partialCopyAudienceKind).toBe('Specific');
    expect(r.expirationEnabled).toBe(false);
  });

  it('un canal por defecto desconocido cae a email', () => {
    const r = defaultRules({ ...firmSettings, defaultVerificationChannel: 'Telegram' });
    expect(r.channels).toEqual(['email']);
  });

  it('el certificado se genera siempre y el PIN/orden no dependen del despacho (firm policy / per-request)', () => {
    const r = defaultRules(firmSettings);
    expect(r.certificate).toBe(true);
    expect(r.certificateGenerationMode).toBe('SingleForRequest');
    expect(r.sequential).toBe(true);
    expect(r.signingPin).toBeNull();
    expect(r.partialCopyAudienceSignerIds).toEqual([]);
  });
});
