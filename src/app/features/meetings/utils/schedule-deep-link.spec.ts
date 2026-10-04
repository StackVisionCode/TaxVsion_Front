import { describe, expect, it } from 'vitest';
import { convertToParamMap } from '@angular/router';
import { customerInviteeDraft, hasScheduleMeetingParams, parseScheduleMeetingDeepLink } from './schedule-deep-link';

describe('deep link /meetings?schedule=1', () => {
  it('lee schedule=1 + customerId + customerName', () => {
    expect(
      parseScheduleMeetingDeepLink(convertToParamMap({ schedule: '1', customerId: 'cus-1', customerName: 'Ana' })),
    ).toEqual({ customerId: 'cus-1', customerName: 'Ana' });
  });

  it('sin schedule=1 o sin customerId no abre nada', () => {
    expect(parseScheduleMeetingDeepLink(convertToParamMap({ customerId: 'cus-1' }))).toBeNull();
    expect(parseScheduleMeetingDeepLink(convertToParamMap({ schedule: '1' }))).toBeNull();
  });

  it('detecta params a limpiar', () => {
    expect(hasScheduleMeetingParams(convertToParamMap({ schedule: '1' }))).toBe(true);
    expect(hasScheduleMeetingParams(convertToParamMap({}))).toBe(false);
  });

  it('arma el invitado customer con los datos del directorio', () => {
    const draft = customerInviteeDraft(
      { customerId: 'cus-1', customerName: 'Ana' },
      { displayName: 'Ana López', primaryEmail: 'ana@example.com' },
    );
    expect(draft).toEqual({
      kind: 'customer',
      userId: null,
      customerId: 'cus-1',
      email: 'ana@example.com',
      name: 'Ana López',
    });
  });

  it('sin directorio cae al nombre del link', () => {
    const draft = customerInviteeDraft({ customerId: 'cus-1', customerName: 'Ana' }, null);
    expect(draft.name).toBe('Ana');
    expect(draft.email).toBeNull();
  });
});
