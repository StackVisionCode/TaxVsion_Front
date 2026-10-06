import { describe, expect, it } from 'vitest';
import { convertToParamMap } from '@angular/router';
import { hasComposeMailParams, parseComposeMailDeepLink } from './compose-deep-link';

describe('deep link /email?compose=1', () => {
  it('lee compose=1 + customerId + to', () => {
    expect(
      parseComposeMailDeepLink(convertToParamMap({ compose: '1', customerId: 'cus-1', to: 'ana@example.com' })),
    ).toEqual({ customerId: 'cus-1', to: 'ana@example.com' });
  });

  it('`to` es opcional', () => {
    expect(parseComposeMailDeepLink(convertToParamMap({ compose: '1', customerId: 'cus-1' }))?.to).toBeNull();
  });

  it('sin compose=1 o sin customerId no abre nada', () => {
    expect(parseComposeMailDeepLink(convertToParamMap({ customerId: 'cus-1' }))).toBeNull();
    expect(parseComposeMailDeepLink(convertToParamMap({ compose: '1' }))).toBeNull();
  });

  it('no confunde los params del callback OAuth con el deep link', () => {
    expect(hasComposeMailParams(convertToParamMap({ connectors_connected: 'true' }))).toBe(false);
    expect(hasComposeMailParams(convertToParamMap({ compose: '1' }))).toBe(true);
  });
});
