import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '@core/auth/auth.service';
import { MeResponse } from '@core/auth/auth.model';
import { AccessStore } from '@core/access/access.store';
import { AccountHandoffStore } from '@core/billing/account-handoff.store';
import { NavbarComponent } from './navbar.component';

/** El botón de usuario del navbar usa `app-avatar`: foto de /storage/avatars si hay, iniciales si no. */
describe('NavbarComponent · foto del usuario', () => {
  let fixture: ComponentFixture<NavbarComponent>;
  let el: HTMLElement;
  const currentUser = signal<MeResponse | null>(null);

  function user(avatarFileId: string | null): MeResponse {
    return {
      id: 'u-1',
      name: 'Ana',
      lastName: 'Diaz',
      email: 'ana@example.com',
      actorType: 'TenantEmployee',
      roles: ['Preparer'],
      tenant: { id: 't-1', name: 'Acme Tax', subDomain: 'acme' },
      avatarFileId,
      avatarPending: false,
    } as unknown as MeResponse;
  }

  const userButton = () => el.querySelector('[data-dropdown="user"] > button') as HTMLButtonElement;

  beforeEach(() => {
    currentUser.set(user(null));
    TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { currentUser } },
        { provide: AccessStore, useValue: { canManageBilling: computed(() => false), canUseId: () => false } },
        {
          provide: AccountHandoffStore,
          useValue: { opening: signal(false), error: signal<string | null>(null), open: () => undefined },
        },
      ],
    });
    fixture = TestBed.createComponent(NavbarComponent);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(async () => {
    // El navbar descarga su store de notificaciones con import() tras el primer render: se espera a que
    // llegue antes de destruir el inyector, o la promesa tardía revienta en otro test.
    const navbar = fixture.componentInstance as unknown as { notificationsStore: () => unknown };
    await vi.waitFor(() => expect(navbar.notificationsStore()).not.toBeNull());
    TestBed.resetTestingModule();
  });

  it('sin foto muestra las iniciales y ninguna imagen', () => {
    const button = userButton();
    expect(button.querySelector('img')).toBeNull();
    expect(button.querySelector('app-avatar')?.textContent).toContain('AD');
    expect(button.textContent).toContain('Open user menu');
  });

  it('con avatarFileId muestra la imagen de /storage/avatars/{id}', () => {
    currentUser.set(user('f-123'));
    fixture.detectChanges();

    const img = userButton().querySelector('app-avatar img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toMatch(/\/storage\/avatars\/f-123$/);
  });

  it('si la imagen no carga vuelve a las iniciales (no deja un círculo vacío)', () => {
    currentUser.set(user('f-broken'));
    fixture.detectChanges();

    userButton().querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(userButton().querySelector('img')).toBeNull();
    expect(userButton().querySelector('app-avatar')?.textContent).toContain('AD');
  });
});
