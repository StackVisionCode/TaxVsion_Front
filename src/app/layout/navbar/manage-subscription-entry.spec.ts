import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { AccessStore } from '@core/access/access.store';
import { AccountHandoffStore } from '@core/billing/account-handoff.store';
import { NavbarComponent } from './navbar.component';

/**
 * La suscripción salió del CRM: ya no hay pantalla ni entrada en el menú lateral. La única puerta es
 * esta fila del menú de usuario, y solo para quien puede abrirla — el backend aplica la misma regla.
 *
 * B3 cambió el criterio: se pregunta por el PERMISO, no por el actor type. `billing.view` es
 * `IsAssignableByTenant:false` en el catálogo, así que solo lo trae el rol raíz de la oficina — el
 * `isAdmin()` que acompañaba al permiso no filtraba nada y contradecía la regla del contrato.
 */
describe('NavbarComponent · Manage subscription', () => {
  function create(canManageBilling: boolean, canUseId: (id: string | undefined) => boolean = () => true) {
    const opened: string[] = [];
    TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        {
          provide: AccessStore,
          useValue: { canManageBilling: computed(() => canManageBilling), canUseId },
        },
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

  it('quien gestiona la facturación la ve y sale al Account', () => {
    const { component, opened } = create(true);

    expect(component.canManageSubscription()).toBe(true);
    component.manageSubscription();
    expect(opened).toEqual(['/account']);
  });

  it('sin billing.view no la ve, aunque sea administrador', () => {
    expect(create(false).component.canManageSubscription()).toBe(false);
  });

  it('las entradas de administración de la oficina salen del registro', () => {
    const { component } = create(false, id => id === 'users');

    expect(component.canUse('users')).toBe(true);
    expect(component.canUse('company-settings')).toBe(false);
  });
});
