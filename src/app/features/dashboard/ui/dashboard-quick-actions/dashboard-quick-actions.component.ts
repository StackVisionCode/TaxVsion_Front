import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  link: string;
  queryParams: Record<string, string>;
  /** Todas deben cumplirse: la de ver la página (su guard) y la de crear (su botón). */
  needs: readonly AccessRequirement[];
}

/**
 * Atajos de creación (como los "quick create" de HubSpot/TaxDome). Cada uno lleva a la página real
 * con un flag de un solo uso (`?new=1` / `?schedule=1`) que esa página consume para abrir su propio
 * panel de alta — no hay formularios duplicados en el dashboard.
 */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: 'client',
    label: 'New client',
    icon: 'person-add-outline',
    link: '/clients',
    queryParams: { new: '1' },
    needs: [
      { module: 'customers', anyOf: ['customers.view'] },
      { module: 'customers', anyOf: ['customers.manage'] },
    ],
  },
  {
    id: 'task',
    label: 'New task',
    icon: 'checkbox-outline',
    link: '/task',
    queryParams: { new: '1' },
    needs: [
      { module: 'planner', anyOf: ['tasks.read'] },
      { module: 'planner', anyOf: ['tasks.write'] },
    ],
  },
  {
    id: 'invoice',
    label: 'New invoice',
    icon: 'receipt-outline',
    link: '/billing',
    queryParams: { new: '1' },
    needs: [
      { module: null, anyOf: ['invoicing.view'] },
      { module: null, anyOf: ['invoicing.manage'] },
    ],
  },
  {
    id: 'signature',
    label: 'Send for signature',
    icon: 'create-outline',
    link: '/signature',
    queryParams: { new: '1' },
    needs: [
      { module: 'signatures', anyOf: ['signature.request.read'] },
      { module: 'signatures', anyOf: ['signature.request.create'] },
    ],
  },
  {
    id: 'meeting',
    label: 'Schedule meeting',
    icon: 'videocam-outline',
    link: '/meetings',
    queryParams: { schedule: '1' },
    needs: [{ module: 'meetings', anyOf: ['communication.meeting.create'] }],
  },
];

@Component({
  selector: 'app-dashboard-quick-actions',
  imports: [RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (actions().length > 0) {
      <nav aria-label="Quick actions" class="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 py-1">
        @for (action of actions(); track action.id) {
          <a [routerLink]="action.link" [queryParams]="action.queryParams"
            class="flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-900 ring-1 ring-brand-line shadow-card transition-colors hover:bg-gray-50">
            <ion-icon [name]="action.icon" class="text-base text-brand-bold" aria-hidden="true"></ion-icon>
            {{ action.label }}
          </a>
        }
      </nav>
    }
  `,
})
export class DashboardQuickActionsComponent {
  private readonly access = inject(AccessStore);

  readonly actions = computed(() =>
    QUICK_ACTIONS.filter(action => action.needs.every(need => this.access.canUse(need))),
  );
}
