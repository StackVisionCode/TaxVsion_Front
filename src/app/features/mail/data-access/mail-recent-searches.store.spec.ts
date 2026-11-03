import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { MAIL_RECENT_SEARCHES_MAX, MailRecentSearchesStore } from './mail-recent-searches.store';

describe('MailRecentSearchesStore', () => {
  const user = signal<{ id: string; tenant: { id: string } } | null>({ id: 'u1', tenant: { id: 't1' } });

  function setup(): MailRecentSearchesStore {
    TestBed.configureTestingModule({
      providers: [MailRecentSearchesStore, { provide: AuthService, useValue: { currentUser: user } }],
    });
    return TestBed.inject(MailRecentSearchesStore);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    user.set({ id: 'u1', tenant: { id: 't1' } });
  });

  afterEach(() => vi.restoreAllMocks());

  it('guarda arriba, sin duplicar (sin distinguir mayúsculas) y persiste por oficina y usuario', () => {
    const store = setup();
    store.add('factura');
    store.add('from:ana@x.com');
    store.add('  FACTURA  ');
    expect(store.recent()).toEqual(['FACTURA', 'from:ana@x.com']);
    expect(JSON.parse(localStorage.getItem('crm.mailRecentSearches.t1.u1')!)).toEqual(['FACTURA', 'from:ana@x.com']);
  });

  it(`se queda con las últimas ${MAIL_RECENT_SEARCHES_MAX}`, () => {
    const store = setup();
    for (let i = 0; i < 12; i++) store.add(`term ${i}`);
    expect(store.recent().length).toBe(MAIL_RECENT_SEARCHES_MAX);
    expect(store.recent()[0]).toBe('term 11');
    expect(store.recent().at(-1)).toBe('term 2');
  });

  it('quitar una y limpiar todas (Clear borra la clave)', () => {
    const store = setup();
    store.add('a1');
    store.add('b2');
    store.remove('a1');
    expect(store.recent()).toEqual(['b2']);
    store.clear();
    expect(store.recent()).toEqual([]);
    expect(localStorage.getItem('crm.mailRecentSearches.t1.u1')).toBeNull();
  });

  it('otro usuario de la misma oficina no ve las del anterior', () => {
    const store = setup();
    store.add('factura');
    user.set({ id: 'u2', tenant: { id: 't1' } });
    expect(store.recent()).toEqual([]);
    user.set({ id: 'u1', tenant: { id: 't1' } });
    expect(store.recent()).toEqual(['factura']);
  });

  it('con localStorage bloqueado funciona en memoria y no lanza', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const store = setup();
    expect(store.recent()).toEqual([]);
    expect(() => store.add('factura')).not.toThrow();
    expect(store.recent()).toEqual(['factura']);
  });

  it('ignora basura guardada y no guarda vacíos', () => {
    localStorage.setItem('crm.mailRecentSearches.t1.u1', JSON.stringify(['ok', 3, null, '  ']));
    const store = setup();
    expect(store.recent()).toEqual(['ok']);
    store.add('   ');
    expect(store.recent()).toEqual(['ok']);
  });

  it('sin sesión no guarda en storage', () => {
    user.set(null);
    const store = setup();
    store.add('factura');
    expect(store.recent()).toEqual(['factura']);
    expect(localStorage.length).toBe(0);
  });
});
