import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { ApiConfigService } from '@core/config/api-config.service';
import { ClientPermissions } from '../../data-access/client-permissions';
import { ClientProfilePageComponent } from './client-profile-page.component';

/**
 * B5 — las pestañas del perfil del cliente. Cada una consulta a un servicio distinto, así que un
 * empleado abría "Calls" o "Notes" y recibía un 403 en una pestaña que la propia aplicación le
 * había ofrecido. Casos 2 y 4 del Anexo C dentro de una página compuesta.
 */
describe('ClientProfilePageComponent · pestañas', () => {
  async function create(options: { permissions?: readonly string[]; modules?: readonly string[] | null } = {}) {
    const permissions = new Set(options.permissions ?? []);
    const modules = options.modules === undefined ? null : options.modules;
    const paramMap = convertToParamMap({ id: 'cus-1' });

    TestBed.configureTestingModule({
      imports: [ClientProfilePageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfigService, useValue: { tenantUrl: (path: string) => `https://api.test${path}` } },
        {
          provide: AccessStore,
          useValue: {
            canUse: (requirement: AccessRequirement) => {
              if (requirement.module !== null && modules !== null && !modules.includes(requirement.module)) {
                return false;
              }
              return requirement.anyOf.length === 0 || requirement.anyOf.some(c => permissions.has(c));
            },
          },
        },
        {
          provide: ClientPermissions,
          useValue: {
            canSetFiscalProfile: signal(false),
            canViewAssignees: signal(false),
            canManage: signal(false),
            canRevealFiscal: signal(false),
          },
        },
        { provide: ActivatedRoute, useValue: { paramMap: of(paramMap), snapshot: { paramMap } } },
      ],
    });
    // Los `@defer` de la plantilla dejan metadata perezosa: hay que compilar antes de crear.
    await TestBed.compileComponents();
    return TestBed.createComponent(ClientProfilePageComponent).componentInstance;
  }

  /** Los ids de pestaña visibles, aplanando los grupos. */
  function tabs(component: ClientProfilePageComponent): string[] {
    return component.navItems().flatMap(entry => (entry.kind === 'tab' ? [entry.id] : entry.tabs.map(t => t.id)));
  }

  afterEach(() => TestBed.resetTestingModule());

  it('sin nada, quedan las pestañas que son el propio cliente', async () => {
    // Quien llegó a esta pantalla ya pasó por `customers.view`: Overview, Details y Family salen
    // del objeto que ya está en la mano, no de otro servicio.
    const component = await create({ permissions: [], modules: [] });

    expect(tabs(component)).toEqual(['overview', 'info', 'family', 'invoices', 'bank', 'mileage', 'portal']);
  });

  it('sin el módulo de comunicación no está la pestaña Calls', async () => {
    const component = await create({
      permissions: ['communication.call.start'],
      modules: ['customers'],
    });

    expect(tabs(component)).not.toContain('calls');
  });

  it('con el módulo y el permiso, Calls aparece', async () => {
    const component = await create({ permissions: ['communication.call.start'], modules: ['comms'] });

    expect(tabs(component)).toContain('calls');
  });

  it('Notes y Reminders piden lo suyo, no solo el módulo', async () => {
    const soloTareas = await create({ permissions: ['tasks.read'], modules: ['planner'] });

    expect(tabs(soloTareas)).toContain('work');
    expect(tabs(soloTareas)).not.toContain('notes');
    expect(tabs(soloTareas)).not.toContain('reminders');
  });

  it('un grupo que se queda sin pestañas desaparece entero', async () => {
    // "Activity" agrupa Work, Documents, Notes, Communication, Calls y Reminders. Sin ninguna, un
    // desplegable vacío es peor que no tener el desplegable.
    const component = await create({ permissions: [], modules: [] });
    const groups = component.navItems().filter(entry => entry.kind === 'group').map(entry => entry.label);

    expect(groups).not.toContain('Activity');
    expect(groups).toContain('Info');
  });

  it('no se puede abrir una pestaña que la fila no muestra', async () => {
    // El deep link de mañana, o un plan que cambia en vivo, entrarían por acá.
    const component = await create({ permissions: [], modules: [] });

    component.selectTab('notes');

    expect(component.activeTab()).toBe('overview');
  });
});
