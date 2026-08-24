import { TestBed } from '@angular/core/testing';
import { environment } from '@env/environment';
import { ApiConfigService } from './api-config.service';

/**
 * El slug del tenant decide a qué host van TODAS las llamadas autenticadas, así que
 * estas pruebas cubren la regresión que rompía el login en producción: entrar directo
 * a `https://<slug>.taxproffice.com` sin `?office=` dejaba el servicio sin slug y
 * `tenantBase()` lanzaba antes de llegar a hacer la request.
 */
describe('ApiConfigService', () => {
  const original = {
    production: environment.production,
    baseDomain: environment.baseDomain,
    systemHost: environment.systemHost,
    apiUrl: environment.apiUrl,
  };

  /** El slug se resuelve al construir el servicio: hay que fijar el host antes de inyectarlo. */
  function serviceAtHost(hostname: string): ApiConfigService {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, hostname },
      writable: true,
      configurable: true,
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ApiConfigService] });
    return TestBed.inject(ApiConfigService);
  }

  beforeEach(() => {
    localStorage.clear();
    environment.production = true;
    environment.baseDomain = 'taxproffice.com';
    environment.systemHost = 'api.taxproffice.com';
  });

  afterEach(() => {
    localStorage.clear();
    Object.assign(environment, original);
  });

  it('deduce el tenant del subdominio cuando no hay nada guardado', () => {
    const service = serviceAtHost('acme.taxproffice.com');
    expect(service.slug()).toBe('acme');
    expect(service.tenantUrl('/auth/login')).toBe('https://acme.taxproffice.com/auth/login');
  });

  it('el host manda sobre el slug guardado de otra oficina', () => {
    localStorage.setItem('tenant_slug', 'globex');
    const service = serviceAtHost('acme.taxproffice.com');
    expect(service.slug()).toBe('acme');
  });

  it('usa el slug guardado cuando el host no identifica a un tenant', () => {
    localStorage.setItem('tenant_slug', 'globex');
    const service = serviceAtHost('app.taxproffice.com');
    expect(service.slug()).toBe('globex');
  });

  it('no toma el host de sistema como si fuera un tenant', () => {
    const service = serviceAtHost('api.taxproffice.com');
    expect(service.slug()).toBeNull();
    expect(() => service.tenantBase()).toThrow();
  });

  it('ignora www', () => {
    expect(serviceAtHost('www.taxproffice.com').slug()).toBeNull();
  });

  it('los endpoints de sistema no dependen del tenant', () => {
    const service = serviceAtHost('acme.taxproffice.com');
    expect(service.systemUrl('/plans')).toBe('https://api.taxproffice.com/plans');
  });

  it('en desarrollo todo cae al gateway local', () => {
    environment.production = false;
    environment.apiUrl = 'http://localhost:5047';
    const service = serviceAtHost('localhost');
    expect(service.tenantUrl('/auth/login')).toBe('http://localhost:5047/auth/login');
    expect(service.systemUrl('/plans')).toBe('http://localhost:5047/plans');
  });
});
