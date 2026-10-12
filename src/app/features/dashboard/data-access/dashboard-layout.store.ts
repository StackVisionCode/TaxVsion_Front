import { Injectable, computed, inject, signal } from '@angular/core';
import { moveItemInArray } from '@angular/cdk/drag-drop';
import { AccessStore } from '@core/access/access.store';
import { DASHBOARD_WIDGET_ACCESS } from './dashboard-widget-access';

export type DashboardWidgetId =
  | 'hero'
  | 'today'
  | 'needs-attention'
  | 'side-stack'
  | 'analytics-stack'
  | 'tasks'
  | 'mini-calendar'
  | 'recent-chats'
  | 'recent-activity'
  | 'video-calls'
  | 'invoices-chart'
  | 'storage-usage'
  | 'signed-documents'
  | 'monthly-clients'
  | 'notes';

export type DashboardColSpan = 1 | 2 | 3;

export interface DashboardWidgetConfig {
  id: DashboardWidgetId;
  colSpan: DashboardColSpan;
}

/**
 * Los anchos pertenecen a las POSICIONES de la grilla, no a los widgets:
 * al reordenar, cada widget adopta la forma del slot donde cae (los
 * componentes son fluidos y se adaptan a cualquier ancho).
 *
 * Filas en desktop (3 columnas): hero | today · needs-attention (ancho completo) · analytics | tasks ·
 * revenue | PRO · y el resto de a tres.
 */
const SLOT_SPANS: ReadonlyArray<DashboardColSpan> = [2, 1, 3, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 1];

export const DEFAULT_ORDER: readonly DashboardWidgetId[] = [
  'hero',
  'today',
  'needs-attention',
  'analytics-stack',
  'tasks',
  'invoices-chart',
  'side-stack',
  'mini-calendar',
  'recent-chats',
  'recent-activity',
  'video-calls',
  'signed-documents',
  'storage-usage',
  'monthly-clients',
  'notes',
];

const STORAGE_KEY = 'tvf.dashboard.layout.v1';

/**
 * Une un orden guardado con el actual: respeta el orden del usuario, ignora ids desconocidos, y mete
 * cada widget nuevo justo después de su vecino anterior en DEFAULT_ORDER (o al principio si no tiene).
 * Así un widget nuevo de arriba (p. ej. `today`) aparece arriba y no al final de la página.
 */
export function mergeSavedOrder(savedIds: readonly string[]): DashboardWidgetId[] {
  const known = new Set<string>(DEFAULT_ORDER);
  const order = savedIds.filter((id): id is DashboardWidgetId => known.has(id));

  DEFAULT_ORDER.forEach((id, defaultIndex) => {
    if (order.includes(id)) {
      return;
    }
    const previous = DEFAULT_ORDER.slice(0, defaultIndex)
      .reverse()
      .find(candidate => order.includes(candidate));
    order.splice(previous ? order.indexOf(previous) + 1 : 0, 0, id);
  });
  return order;
}

/**
 * Store del layout del dashboard (orden de widgets + modo edición).
 * Feature-scoped: se provee en dashboard.routes.ts.
 *
 * Persistencia: por ahora localStorage. Cuando exista backend, la
 * integración se hace reemplazando SOLO `loadLayout()` y `saveLayout()`
 * por llamadas HTTP — el resto del store y sus consumidores no cambian.
 */
@Injectable()
export class DashboardLayoutStore {
  private readonly access = inject(AccessStore);

  private readonly _order = signal<DashboardWidgetId[]>(this.loadLayout());
  private readonly _editMode = signal(false);

  /**
   * Los widgets que el usuario puede usar, en su orden, con el ancho del slot que ocupan.
   *
   * El orden GUARDADO conserva los escondidos: si mañana la oficina contrata el módulo, el widget
   * vuelve a su sitio en vez de aparecer al final. El ancho se toma del slot que ocupa una vez
   * filtrado, para que la grilla no quede con huecos.
   */
  readonly widgets = computed<DashboardWidgetConfig[]>(() =>
    this._order()
      .filter(id => this.canUse(id))
      .map((id, index) => ({ id, colSpan: SLOT_SPANS[index] ?? 1 })),
  );

  private canUse(id: DashboardWidgetId): boolean {
    // El banner PRO es lo único del side-stack: si no se puede gestionar el plan, el slot quedaba vacío.
    if (id === 'side-stack') {
      return this.access.canManageBilling();
    }
    const requirement = DASHBOARD_WIDGET_ACCESS[id];
    if (requirement === null) {
      return true;
    }
    const anyOf = Array.isArray(requirement) ? requirement : [requirement];
    return anyOf.some(req => this.access.canUse(req));
  }

  readonly editMode = this._editMode.asReadonly();

  readonly isDirty = computed(() => this._order().join(',') !== DEFAULT_ORDER.join(','));

  toggleEditMode(): void {
    this._editMode.update(on => !on);
  }

  /**
   * Mueve un widget. Los índices llegan del CDK, o sea de la lista VISIBLE, y el orden que se
   * guarda es el COMPLETO: hay que traducir por id. Aplicar el índice visible sobre la lista
   * completa movería otro widget en cuanto haya uno escondido.
   */
  move(previousIndex: number, currentIndex: number): void {
    if (previousIndex === currentIndex) {
      return;
    }
    const visible = this.widgets();
    const from = this._order().indexOf(visible[previousIndex]?.id);
    const to = this._order().indexOf(visible[currentIndex]?.id);
    if (from < 0 || to < 0) {
      return;
    }

    this._order.update(order => {
      const next = [...order];
      moveItemInArray(next, from, to);
      return next;
    });
    this.saveLayout(this._order());
  }

  resetLayout(): void {
    this._order.set([...DEFAULT_ORDER]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage puede no estar disponible (SSR/privacidad); no es crítico.
    }
  }

  /** Punto de integración futuro con backend: GET del layout del usuario. */
  private loadLayout(): DashboardWidgetId[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [...DEFAULT_ORDER];
      }
      return mergeSavedOrder(JSON.parse(raw) as string[]);
    } catch {
      return [...DEFAULT_ORDER];
    }
  }

  /** Punto de integración futuro con backend: PUT del layout del usuario. */
  private saveLayout(order: DashboardWidgetId[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    } catch {
      // Sin persistencia disponible: el orden vive solo en memoria.
    }
  }
}
