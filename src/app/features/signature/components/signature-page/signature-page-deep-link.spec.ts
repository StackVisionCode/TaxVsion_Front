import { describe, expect, it } from 'vitest';
import { convertToParamMap } from '@angular/router';
import { hasNewSignatureParams, parseNewSignatureDeepLink } from './signature-page-deep-link';

describe('parseNewSignatureDeepLink', () => {
  it('lee new=1 + customerId + customerName', () => {
    expect(
      parseNewSignatureDeepLink(convertToParamMap({ new: '1', customerId: 'cus-1', customerName: 'Ana López' })),
    ).toEqual({ customerId: 'cus-1', customerName: 'Ana López' });
  });

  it('sin new=1 no hace nada', () => {
    expect(parseNewSignatureDeepLink(convertToParamMap({ customerId: 'cus-1' }))).toBeNull();
  });

  it('sin customerId no hay cliente que preseleccionar', () => {
    expect(parseNewSignatureDeepLink(convertToParamMap({ new: '1', customerId: '  ' }))).toBeNull();
  });

  it('el nombre es opcional', () => {
    expect(parseNewSignatureDeepLink(convertToParamMap({ new: '1', customerId: 'cus-1' }))?.customerName).toBeNull();
  });

  it('detecta params a limpiar', () => {
    expect(hasNewSignatureParams(convertToParamMap({ new: '1' }))).toBe(true);
    expect(hasNewSignatureParams(convertToParamMap({ page: '2' }))).toBe(false);
  });
});
