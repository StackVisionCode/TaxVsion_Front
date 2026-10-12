import { describe, expect, it } from 'vitest';
import { convertToParamMap } from '@angular/router';
import { hasNewSignatureParams, parseNewSignatureDeepLink, wantsBlankNewRequest } from './signature-page-deep-link';

describe('wantsBlankNewRequest', () => {
  it('new=1 sin customerId pide el wizard vacío', () => {
    expect(wantsBlankNewRequest(convertToParamMap({ new: '1' }))).toBe(true);
    expect(wantsBlankNewRequest(convertToParamMap({ new: '1', customerId: '  ' }))).toBe(true);
  });

  it('con cliente o sin new=1 no aplica', () => {
    expect(wantsBlankNewRequest(convertToParamMap({ new: '1', customerId: 'cus-1' }))).toBe(false);
    expect(wantsBlankNewRequest(convertToParamMap({}))).toBe(false);
  });
});

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
