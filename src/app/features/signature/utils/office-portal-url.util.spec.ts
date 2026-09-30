import { buildOfficePortalLoginUrl } from './office-portal-url.util';

describe('buildOfficePortalLoginUrl', () => {
  const prod = { production: true, baseDomain: 'taxproffice.com' };

  it('en prod arma el login del portal en el subdominio de la oficina', () => {
    expect(buildOfficePortalLoginUrl('acme', prod)).toBe('https://acme.taxproffice.com/portal/client/auth/login');
    expect(buildOfficePortalLoginUrl('  Acme-Tax ', prod)).toBe(
      'https://acme-tax.taxproffice.com/portal/client/auth/login',
    );
  });

  it('sin slug o con un slug inválido no redirige (null)', () => {
    expect(buildOfficePortalLoginUrl(null, prod)).toBeNull();
    expect(buildOfficePortalLoginUrl('', prod)).toBeNull();
    expect(buildOfficePortalLoginUrl('evil.com/x', prod)).toBeNull();
    expect(buildOfficePortalLoginUrl('-bad', prod)).toBeNull();
  });

  it('en dev usa portalDevUrl si está configurado, si no null', () => {
    const dev = { production: false, baseDomain: 'localhost' };
    expect(buildOfficePortalLoginUrl('acme', dev)).toBeNull();
    expect(buildOfficePortalLoginUrl(null, { ...dev, portalDevUrl: 'http://localhost:4300/' })).toBe(
      'http://localhost:4300/client/auth/login',
    );
  });
});
