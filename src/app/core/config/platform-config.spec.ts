import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '@env/environment';
import {
  applyPlatformSettings,
  initialPlatformConfig,
  loadPlatformSettings,
  platformBrand,
  platformConfig,
  resetPlatformConfigForTests,
} from './platform-config';

/**
 * El CRM no lleva el dominio ni el nombre de la plataforma "horneados": salen del host que lo sirve y
 * de PlatformSettings. Si esto se rompe, un cambio de dominio desde PlatformAdmin vuelve a exigir
 * recompilar el bundle.
 */
describe('platformConfig', () => {
  const original = { ...environment };

  beforeEach(() => {
    environment.production = true;
    environment.baseDomain = 'taxoffix.io';
    environment.systemHost = 'api.taxoffix.io';
    environment.brandName = 'TaxOffix';
  });

  afterEach(() => {
    Object.assign(environment, original);
    resetPlatformConfigForTests();
    vi.unstubAllGlobals();
  });

  it('en prod toma el dominio del host que sirve la app, no el del build', () => {
    expect(initialPlatformConfig('acme.newbrand.com')).toMatchObject({
      baseDomain: 'newbrand.com',
      systemHost: 'api.newbrand.com',
    });
    expect(initialPlatformConfig('APP.NewBrand.com.')).toMatchObject({ baseDomain: 'newbrand.com' });
  });

  it('sin un host de la plataforma (localhost, IP) se queda con el environment', () => {
    expect(initialPlatformConfig('localhost').baseDomain).toBe('taxoffix.io');
    expect(initialPlatformConfig('10.0.0.12').baseDomain).toBe('taxoffix.io');
    expect(initialPlatformConfig(null).systemHost).toBe('api.taxoffix.io');
  });

  it('en dev no deriva nada del host', () => {
    environment.production = false;
    environment.baseDomain = 'localhost';
    expect(initialPlatformConfig('acme.newbrand.com').baseDomain).toBe('localhost');
  });

  it('aplica una versión nueva y no deja que una vieja la pise', () => {
    resetPlatformConfigForTests('app.taxoffix.io');

    expect(
      applyPlatformSettings({ version: 4, brandName: 'NewBrand', baseDomain: 'NewBrand.com', apiHost: 'api.newbrand.com' }),
    ).toBe(true);
    expect(applyPlatformSettings({ version: 3, brandName: 'Old', baseDomain: 'old.io', apiHost: 'api.old.io' })).toBe(
      false,
    );

    expect(platformBrand()).toBe('NewBrand');
    expect(platformConfig()).toMatchObject({ version: 4, baseDomain: 'newbrand.com', systemHost: 'api.newbrand.com' });
  });

  it('ignora una respuesta sin dominio o sin nombre', () => {
    resetPlatformConfigForTests('app.taxoffix.io');

    expect(applyPlatformSettings({ version: 9, brandName: ' ', baseDomain: 'x.io', apiHost: '' })).toBe(false);
    expect(applyPlatformSettings({ version: 9, brandName: 'X', baseDomain: '', apiHost: '' })).toBe(false);
    expect(platformBrand()).toBe('TaxOffix');
  });

  it('al arrancar pide la versión vigente al host de sistema', async () => {
    resetPlatformConfigForTests('acme.taxoffix.io');
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ version: 2, brandName: 'TaxOffix Pro', baseDomain: 'taxoffix.io', apiHost: 'api.taxoffix.io' })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await loadPlatformSettings();

    expect(fetchMock).toHaveBeenCalledWith('https://api.taxoffix.io/platform/settings/public', expect.anything());
    expect(platformBrand()).toBe('TaxOffix Pro');
  });

  it('si Tenant falla el arranque sigue con lo que había', async () => {
    resetPlatformConfigForTests('acme.taxoffix.io');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));

    await loadPlatformSettings();

    expect(platformConfig()).toMatchObject({ version: 0, brandName: 'TaxOffix', baseDomain: 'taxoffix.io' });
  });
});
