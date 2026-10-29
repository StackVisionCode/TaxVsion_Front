import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, filter, map, of } from 'rxjs';
import { vi } from 'vitest';
import { ApiConfigService } from '@core/config/api-config.service';
import { AuthService } from '@core/auth/auth.service';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { StaffDirectoryStore } from './staff-directory.store';

function row(id: string, name: string, isActive: boolean, status: string, avatarFileId?: string | null) {
  return {
    id,
    name,
    lastName: 'Smith',
    email: `${name.toLowerCase()}@acme.test`,
    actorType: 'TenantEmployee',
    isActive,
    status,
    ...(avatarFileId !== undefined ? { avatarFileId } : {}),
  };
}

/**
 * El directorio pone nombre a las asignaciones existentes. Un suspendido conserva sus clientes, así que
 * tiene que estar en la lista o la tarjeta dice "Unknown user"; pero no se le pueden asignar más.
 */
describe('StaffDirectoryStore', () => {
  let store: StaffDirectoryStore;
  let http: HttpTestingController;
  let events$: Subject<{ event: string; payload: unknown }>;
  const currentUser = signal<Record<string, unknown> | null>(null);
  const me = vi.fn(() => of({}));

  beforeEach(() => {
    events$ = new Subject();
    currentUser.set({ id: 'me', name: 'Ada', lastName: 'Smith', tenant: { id: 't1' }, avatarFileId: null });
    me.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ApiConfigService,
          useValue: { tenantUrl: (path: string) => `http://test${path}`, tenantBase: () => 'http://test' },
        },
        { provide: AuthService, useValue: { currentUser, me } },
        {
          provide: CommunicationRealtimeService,
          useValue: {
            on: (name: string) =>
              events$.pipe(
                filter(e => e.event === name),
                map(e => e.payload),
              ),
          },
        },
      ],
    });
    store = TestBed.inject(StaffDirectoryStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function flushFirstPage(items: unknown[], totalPages = 1) {
    const request = http.expectOne(r => r.url === 'http://test/auth/users' && r.params.get('page') === '1');
    expect(request.request.params.get('accountKind')).toBe('Staff');
    request.flush({ items, totalPages });
  }

  it('el suspendido entra al directorio pero no es asignable', () => {
    store.ensureLoaded();
    flushFirstPage([row('u1', 'Ada', true, 'Active'), row('u2', 'Grace', false, 'Deactivated')]);

    expect(store.members().map(m => m.userId)).toEqual(['u1', 'u2']);
    expect(store.assignable().map(m => m.userId)).toEqual(['u1']);
    expect(store.resolve('u2')?.name).toBe('Grace Smith');
    expect(store.search('').map(m => m.userId)).toEqual(['u1']);
  });

  it('trae las páginas que falten, no solo las primeras 100', () => {
    store.ensureLoaded();
    flushFirstPage([row('u1', 'Ada', true, 'Active')], 2);
    http
      .expectOne(r => r.url === 'http://test/auth/users' && r.params.get('page') === '2')
      .flush({ items: [row('u2', 'Bob', true, 'Active')], totalPages: 2 });

    expect(store.members().map(m => m.name)).toEqual(['Ada Smith', 'Bob Smith']);
  });

  it('carga una sola vez', () => {
    store.ensureLoaded();
    flushFirstPage([row('u1', 'Ada', true, 'Active')]);
    store.ensureLoaded();

    http.expectNone(() => true);
  });

  it('si la lectura falla el directorio queda vacío, sin romper la pantalla', () => {
    store.ensureLoaded();
    http
      .expectOne(r => r.url === 'http://test/auth/users')
      .flush({ message: 'nope' }, { status: 403, statusText: 'Forbidden' });

    expect(store.members()).toEqual([]);
  });

  it('trae la foto de cada miembro y arma su URL anónima', () => {
    store.ensureLoaded();
    flushFirstPage([row('u1', 'Ada', true, 'Active', 'f-1'), row('u2', 'Bob', true, 'Active')]);

    expect(store.resolve('u1')?.avatarFileId).toBe('f-1');
    expect(store.avatarUrlFor('u1')).toBe('http://test/storage/avatars/f-1');
    expect(store.avatarUrlFor('u2')).toBeNull();
    expect(store.avatarUrlFor('nobody')).toBeNull();
    expect(store.avatarUrlFor(null)).toBeNull();
  });

  it('user.profile.changed actualiza la foto y el nombre en vivo', () => {
    store.ensureLoaded();
    flushFirstPage([row('u1', 'Ada', true, 'Active', 'f-1')]);
    store.startRealtime();

    events$.next({ event: 'user.profile.changed', payload: { userId: 'u1', displayName: 'Ada L.', avatarFileId: 'f-2' } });
    expect(store.resolve('u1')?.avatarFileId).toBe('f-2');
    expect(store.resolve('u1')?.name).toBe('Ada L.');

    // Campo ausente = se conserva; null = sin foto.
    events$.next({ event: 'user.profile.changed', payload: { userId: 'u1' } });
    expect(store.resolve('u1')?.avatarFileId).toBe('f-2');
    events$.next({ event: 'user.profile.changed', payload: { userId: 'u1', avatarFileId: null } });
    expect(store.avatarUrlFor('u1')).toBeNull();
    expect(me).not.toHaveBeenCalled();
  });

  it('si el cambio es mío rehidrata la sesión, salvo que ya lo tenga', () => {
    store.startRealtime();
    store.startRealtime(); // idempotente: una sola suscripción

    events$.next({ event: 'user.profile.changed', payload: { userId: 'me', avatarFileId: null } });
    expect(me).not.toHaveBeenCalled();

    events$.next({ event: 'user.profile.changed', payload: { userId: 'me', avatarFileId: 'f-9' } });
    expect(me).toHaveBeenCalledTimes(1);
  });

  it('al cambiar de sesión olvida el directorio anterior', () => {
    store.ensureLoaded();
    flushFirstPage([row('u1', 'Ada', true, 'Active')]);
    TestBed.tick();

    currentUser.set({ id: 'other', name: 'Bob', lastName: 'Smith', tenant: { id: 't2' } });
    TestBed.tick();

    expect(store.members()).toEqual([]);
    store.ensureLoaded();
    flushFirstPage([row('u9', 'Zed', true, 'Active')]);
    expect(store.members().map(m => m.userId)).toEqual(['u9']);
  });
});
