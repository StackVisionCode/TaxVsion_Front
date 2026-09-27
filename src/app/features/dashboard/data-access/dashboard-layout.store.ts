import { Injectable, computed, inject, signal } from '@angular/core';
import { moveItemInArray } from '@angular/cdk/drag-drop';
import { AccessStore } from '@core/access/access.store';
import { DASHBOARD_WIDGET_ACCESS } from './dashboard-widget-access';

export type DashboardWidgetId =
  | 'hero'
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

export interface DashboardWidgetConfig {
  id: DashboardWidgetId;
  colSpan: 1 | 2;
}

/**
 * Los anchos pertenecen a las POSICIONES de la grilla, no a los widgets:
 * al reordenar, cada widget adopta la forma del slot donde cae (los
 * componentes son fluidos y se adaptan a cualquier ancho).
 */
const SLOT_SPANS: ReadonlyArray<1 | 2> = [2, 1, 2, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1];

const DEFAULT_ORDER: DashboardWidgetId[] = [
  'hero',
  'side-stack',
  'analytics-stack',
  'tasks',
  'mini-calendar',
  'recent-chats',
  'recent-activity',
  'video-calls',
  'invoices-chart',
  'storage-usage',
  'signed-documents',
  'monthly-clients',
  'notes',
];

const STORAGE_KEY = 'tvf.dashboard.layout.v1';

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
    const requirement = DASHBOARD_WIDGET_ACCESS[id];
    return requirement === null || this.access.canUse(requirement);
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
      const savedIds = JSON.parse(raw) as string[];
      const known = new Set<string>(DEFAULT_ORDER);

      // Merge: respeta el orden guardado ignorando ids desconocidos, y añade
      // al final cualquier widget nuevo que no existiera cuando se guardó.
      const ordered = savedIds.filter((id): id is DashboardWidgetId => known.has(id));
      const missing = DEFAULT_ORDER.filter(id => !ordered.includes(id));
      return [...ordered, ...missing];
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
