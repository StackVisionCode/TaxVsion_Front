import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicFormSessionStorageService } from './public-form-session-storage.service';

describe('PublicFormSessionStorageService', () => {
  let service: PublicFormSessionStorageService;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(PublicFormSessionStorageService);
  });

  afterEach(() => sessionStorage.clear());

  it('aisla la sesion por tipo y token de acceso', () => {
    const session = {
      sessionToken: 'session-a',
      expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
      requestId: 'request-a',
    };

    service.write('directed', 'link-a', session);

    expect(service.read('directed', 'link-a')).toEqual(session);
    expect(service.read('directed', 'link-b')).toBeNull();
    expect(service.read('intake', 'link-a')).toBeNull();
  });

  it('guarda solo el grant de sesion y nunca las respuestas', () => {
    service.write('intake', 'link-a', {
      sessionToken: 'session-a',
      expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
      requestId: 'request-a',
    });

    const raw = Object.values(sessionStorage).join(' ');
    expect(raw).toContain('session-a');
    expect(raw).not.toContain('answers');
    expect(raw).not.toContain('values');
  });

  it('descarta una sesion vencida', () => {
    service.write('directed', 'link-a', {
      sessionToken: 'expired',
      expiresAtUtc: new Date(Date.now() - 1_000).toISOString(),
      requestId: null,
    });

    expect(service.read('directed', 'link-a')).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('mantiene la sesion en memoria si el storage del navegador falla', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    const session = {
      sessionToken: 'memory-session',
      expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
      requestId: null,
    };

    service.write('directed', 'link-a', session);

    expect(service.read('directed', 'link-a')).toEqual(session);
    setItem.mockRestore();
  });
});
