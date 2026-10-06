import { describe, expect, it } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import type { ContactPointResponse } from './clients.model';
import { clientSmsErrorMessage, clientSmsOutcome, clientSmsPhoneOptions } from './client-sms.model';

function phone(value: string, partial: Partial<ContactPointResponse> = {}): ContactPointResponse {
  return { id: value, type: 'Phone', value, isPrimary: false, label: null, ...partial };
}

describe('clientSmsPhoneOptions · qué teléfonos se ofrecen para el SMS', () => {
  it('el principal va primero y se normaliza a E.164', () => {
    const options = clientSmsPhoneOptions('+18095551234', [phone('+13055550000', { label: 'Work' })]);
    expect(options.map(o => o.value)).toEqual(['+18095551234', '+13055550000']);
    expect(options[0].label).toBe('+1 (809) 555-1234 · Primary');
    expect(options[1].label).toContain('Work');
  });

  it('aplica la conveniencia US (10 dígitos → +1) y deduplica contra el principal', () => {
    const options = clientSmsPhoneOptions('+18095551234', [phone('(809) 555-1234'), phone('305 555 0000')]);
    expect(options.map(o => o.value)).toEqual(['+18095551234', '+13055550000']);
  });

  it('descarta los inválidos y los contactos que no son teléfonos', () => {
    const options = clientSmsPhoneOptions('123', [
      phone('abc'),
      { id: 'e', type: 'Email', value: 'ana@example.com', isPrimary: true },
    ]);
    expect(options).toEqual([]);
  });

  it('entre contactos, el primario antes que el resto', () => {
    const options = clientSmsPhoneOptions(null, [phone('+13055550000'), phone('+13055551111', { isPrimary: true })]);
    expect(options.map(o => o.value)).toEqual(['+13055551111', '+13055550000']);
    expect(options[0].label).toContain('Primary contact');
  });
});

describe('clientSmsOutcome / clientSmsErrorMessage · errores claros', () => {
  const ok = (status: string, errorCode: string | null = null) =>
    clientSmsOutcome({
      batchId: 'b',
      correlationId: 'c',
      results: [{ messageId: 'm', customerId: 'x', to: '+1', status: status as never, providerMessageId: null, errorCode }],
    });

  it('Accepted = enviado', () => {
    expect(ok('Accepted').ok).toBe(true);
  });

  it('Suppressed = el cliente hizo STOP', () => {
    const outcome = ok('Suppressed');
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('opted out');
  });

  it('número inválido', () => {
    expect(ok('Failed', 'sms.invalidDestination').message).toContain("can't receive text messages");
  });

  it('403 y 429 se explican', () => {
    expect(clientSmsErrorMessage(new HttpErrorResponse({ status: 403 }))).toContain("don't have permission");
    expect(clientSmsErrorMessage(new HttpErrorResponse({ status: 429 }))).toContain('Too many messages');
  });

  it('un código sms.* del cuerpo del error se traduce', () => {
    const err = new HttpErrorResponse({ status: 400, error: { code: 'sms.invalidDestination', message: 'raw' } });
    expect(clientSmsErrorMessage(err)).toContain("can't receive text messages");
  });
});
