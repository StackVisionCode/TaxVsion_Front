import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PermissionService } from '@core/auth/permission.service';
import { AccountHandoffStore } from '@core/billing/account-handoff.store';
import { NavbarComponent } from './navbar.component';

/**
 * La suscripción salió del CRM: ya no hay pantalla ni entrada en el menú lateral. La única puerta es esta
 * fila del menú de usuario, y solo para quien puede abrirla — el backend aplica la misma regla.
 */
describe('NavbarComponent · Manage subscription', () => {
  function create(isAdmin: boolean, permission: boolean) {
    const opened: string[] = [];
    TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        { provide: PermissionService, useValue: { isAdmin: () => isAdmin, has: () => permission } },
        {
          provide: AccountHandoffStore,
          useValue: { opening: signal(false), error: signal<string | null>(null), open: (s?: string) => opened.push(s ?? '/account') },
        },
      ],
    });
    const component = TestBed.createComponent(NavbarComponent).componentInstance;
    return { component, opened };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('el administrador con billing.view la ve y sale al Account', () => {
    const { component, opened } = create(true, true);

    expect(component.canManageSubscription()).toBe(true);
    component.manageSubscription();
    expect(opened).toEqual(['/account']);
  });

  it('un empleado no la ve', () => {
    expect(create(false, true).component.canManageSubscription()).toBe(false);
  });

  it('un administrador sin billing.view tampoco', () => {
    expect(create(true, false).component.canManageSubscription()).toBe(false);
  });
});
