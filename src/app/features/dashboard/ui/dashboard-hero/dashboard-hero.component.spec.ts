import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { DashboardInvoicesStore } from '../../data-access/dashboard-invoices.store';
import { TaskStore } from '../../../task/data-access/task.store';
import { DashboardHeroComponent } from './dashboard-hero.component';

/**
 * B5 — el hero no se esconde (lleva el saludo y es lo primero que se ve), pero sus tres contadores
 * salen de dos servicios distintos. Al empleado sin facturación le quedaban dos tarjetas con "—" y
 * un error debajo que no se arregla recargando.
 */
describe('DashboardHeroComponent', () => {
  let loaded: string[];

  function create(options: { permissions?: readonly string[]; modules?: readonly string[] | null }) {
    loaded = [];
    const permissions = new Set(options.permissions ?? []);
    const modules = options.modules === undefined ? null : options.modules;

    TestBed.configureTestingModule({
      imports: [DashboardHeroComponent],
      providers: [
        provideRouter([]),
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
          provide: TaskStore,
          useValue: {
            init: () => loaded.push('tasks'),
            loading: signal(false),
            error: signal(null),
            tasks: signal([]),
          },
        },
        {
          provide: DashboardInvoicesStore,
          useValue: {
            load: () => loaded.push('invoices'),
            loading: signal(false),
            error: signal(null),
            openInvoices: signal([]),
            collectedThisMonthCents: signal(0),
            currency: signal('USD'),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(DashboardHeroComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('con todo, las tres tarjetas', () => {
    const fixture = create({ permissions: ['tasks.read', 'invoicing.view'], modules: ['planner'] });

    expect(fixture.componentInstance.stats().map(s => s.title)).toEqual([
      'Overdue Tasks',
      'Outstanding Invoices',
      'Revenue This Month',
    ]);
  });

  it('sin facturación quedan solo las tarjetas que puede ver', () => {
    const fixture = create({ permissions: ['tasks.read'], modules: ['planner'] });

    expect(fixture.componentInstance.stats().map(s => s.title)).toEqual(['Overdue Tasks']);
  });

  it('sin el módulo de planner tampoco está la de tareas', () => {
    const fixture = create({ permissions: ['tasks.read', 'invoicing.view'], modules: [] });

    expect(fixture.componentInstance.stats().map(s => s.title)).not.toContain('Overdue Tasks');
  });

  it('no pide al backend lo que no va a mostrar', () => {
    // No es solo estética: son peticiones que sabemos de antemano que van a dar 403.
    create({ permissions: ['tasks.read'], modules: ['planner'] });

    expect(loaded).toEqual(['tasks']);
  });
});
