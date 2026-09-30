import { ContactPointResponse } from './clients.model';
import { smsOutcome, smsPhoneOptions } from './client-sms.model';

describe('client-sms.model', () => {
  const phone = (value: string, label: string | null = null): ContactPointResponse => ({
    id: value,
    type: 'Phone',
    value,
    label,
    isPrimary: false,
  });

  it('pone primero el teléfono principal y luego los móviles, sin duplicados', () => {
    const options = smsPhoneOptions({
      phone: '+15551234567',
      contactPoints: [
        phone('+15550000001', 'Office'),
        phone('+15550000002', 'Mobile'),
        phone('+1 (555) 123-4567', 'Home'), // mismo número que el principal
        { id: 'e', type: 'Email', value: 'a@b.com', label: null, isPrimary: true },
      ],
    });
    expect(options.map(o => o.value)).toEqual(['+15551234567', '+15550000002', '+15550000001']);
    expect(options[1].label).toContain('Mobile');
  });

  it('aplica la conveniencia US (10 dígitos → +1) y descarta números inválidos', () => {
    const options = smsPhoneOptions({ phone: '5551234567', contactPoints: [phone('123', 'Mobile')] });
    expect(options.map(o => o.value)).toEqual(['+15551234567']);
  });

  it('sin teléfono no hay opciones', () => {
    expect(smsPhoneOptions({ phone: '', contactPoints: [] })).toEqual([]);
  });

  it('traduce el resultado por item a un mensaje amable', () => {
    const base = { batchId: 'b', correlationId: 'c' };
    const item = { messageId: 'm', customerId: 'cus', to: '+15551234567', providerMessageId: null, errorCode: null };
    expect(smsOutcome({ ...base, results: [{ ...item, status: 'Accepted' }] }).ok).toBe(true);
    const suppressed = smsOutcome({ ...base, results: [{ ...item, status: 'Suppressed' }] });
    expect(suppressed.ok).toBe(false);
    expect(suppressed.message).toContain('opted out');
    const invalid = smsOutcome({
      ...base,
      results: [{ ...item, status: 'Failed', errorCode: 'sms.invalidDestination' }],
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.message).toContain("can't receive text messages");
  });
});
