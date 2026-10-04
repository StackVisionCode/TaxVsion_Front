import { defaultRules } from '../ui/signature-request-panel/signature-wizard.presenter';
import {
  isSigningPinInvalid,
  reminderIntervalDays,
  toggleRule,
  withDefaultChannel,
  withReminderIntervalDays,
  withSequential,
  withSigningPin,
} from './request-rules.util';

describe('request-rules.util (mismas reglas que tenía el editor)', () => {
  it('orden y canal por defecto', () => {
    expect(withSequential(defaultRules(), false).sequential).toBe(false);
    expect(withDefaultChannel(defaultRules(), 'sms').channels).toEqual(['sms']);
  });

  it('intervalo en días ↔ horas con clamp 1..30', () => {
    expect(reminderIntervalDays(defaultRules())).toBe(2);
    expect(withReminderIntervalDays(defaultRules(), 3).reminderIntervalHours).toBe(72);
    expect(withReminderIntervalDays(defaultRules(), 99).reminderIntervalHours).toBe(720);
    expect(withReminderIntervalDays(defaultRules(), 0).reminderIntervalHours).toBe(24);
  });

  it('"send certificate" no se activa sin certificado', () => {
    const noCert = { ...defaultRules(), certificate: false };
    expect(toggleRule(noCert, 'sendCertificate')).toBe(noCert);
    expect(toggleRule(defaultRules(), 'sendCertificate').sendCertificate).toBe(true);
    expect(toggleRule(defaultRules(), 'autoReminder').autoReminder).toBe(false);
  });

  it('PIN: solo dígitos, máx 10, vacío = null; 1–3 dígitos es inválido', () => {
    expect(withSigningPin(defaultRules(), '12a34567890123').signingPin).toBe('1234567890');
    expect(withSigningPin(defaultRules(), '').signingPin).toBeNull();
    expect(isSigningPinInvalid(withSigningPin(defaultRules(), '123'))).toBe(true);
    expect(isSigningPinInvalid(withSigningPin(defaultRules(), '1234'))).toBe(false);
    expect(isSigningPinInvalid(defaultRules())).toBe(false);
    expect(isSigningPinInvalid(null)).toBe(false);
  });
});
