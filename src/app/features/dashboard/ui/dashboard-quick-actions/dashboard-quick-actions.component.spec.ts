import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { DashboardQuickActionsComponent, QUICK_ACTIONS } from './dashboard-quick-actions.component';

const ALL_PERMISSIONS = QUICK_ACTIONS.flatMap(action => action.needs.flatMap(need => need.anyOf));

function render(granted: readonly string[]) {
  const set = new Set(granted);
  TestBed.configureTestingModule({
    imports: [DashboardQuickActionsComponent],
    providers: [
      provideRouter([]),
      {
        provide: AccessStore,
        useValue: { canUse: (need: AccessRequirement) => need.anyOf.some(code => set.has(code)) },
      },
    ],
  });
  const fixture = TestBed.createComponent(DashboardQuickActionsComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { el, labels: Array.from(el.querySelectorAll('a')).map(a => a.textContent?.trim()) };
}

describe('DashboardQuickActionsComponent', () => {
  it('con todos los permisos muestra las 5 acciones con su flag de un solo uso', () => {
    const { el, labels } = render(ALL_PERMISSIONS);
    expect(labels).toEqual(['New client', 'New task', 'New invoice', 'Send for signature', 'Schedule meeting']);
    const hrefs = Array.from(el.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/clients?new=1',
      '/task?new=1',
      '/billing?new=1',
      '/signature?new=1',
      '/meetings?schedule=1',
    ]);
  });

  for (const action of QUICK_ACTIONS) {
    for (const need of action.needs) {
      it(`oculta "${action.label}" sin ${need.anyOf.join('/')}`, () => {
        const { labels } = render(ALL_PERMISSIONS.filter(code => !need.anyOf.includes(code)));
        expect(labels).not.toContain(action.label);
      });
    }
  }

  it('ver sin poder crear no basta (ej. clientes: view sin manage)', () => {
    const { labels } = render(['customers.view']);
    expect(labels).not.toContain('New client');
  });

  it('sin ninguna acción disponible no pinta la fila', () => {
    const { el } = render([]);
    expect(el.querySelector('nav')).toBeNull();
  });
});
