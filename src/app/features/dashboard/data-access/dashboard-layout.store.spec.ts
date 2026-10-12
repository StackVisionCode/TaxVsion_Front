import { TestBed } from '@angular/core/testing';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { DashboardLayoutStore, DashboardWidgetId, mergeSavedOrder } from './dashboard-layout.store';
import { DASHBOARD_WIDGET_ACCESS } from './dashboard-widget-access';

const ALL_PERMISSIONS = [
  'tasks.read',
  'calendar.read',
  'notes.read',
  'communication.chat.start',
  'communication.meeting.create',
  'invoicing.view',
  'cloudstorage.settings.manage',
  'signature.request.read',
  'customers.view',
  'wallet.view',
];
const ALL_MODULES = ['planner', 'comms', 'meetings', 'documents', 'signatures', 'customers'];

/**
 * B5 — el dashboard dejaba de ser "13 tarjetas, algunas con error". Un empleado sin el módulo de
 * planner veía las suyas y, al lado, cuatro tarjetas rojas con 403 que no podía resolver.
 */
describe('DashboardLayoutStore', () => {
  function create(
    options: { permissions?: readonly string[]; modules?: readonly string[] | null; billing?: boolean } = {},
  ) {
    const permissions = new Set(options.permissions ?? []);
    const modules = options.modules === undefined ? null : options.modules;
    const billing = options.billing ?? false;

    localStorage.removeItem('tvf.dashboard.layout.v1');

    TestBed.configureTestingModule({
      providers: [
        DashboardLayoutStore,
        {
          provide: AccessStore,
          useValue: {
            canManageBilling: () => billing,
            canUse: (requirement: AccessRequirement) => {
              if (requirement.module !== null && modules !== null && !modules.includes(requirement.module)) {
                return false;
              }
              return (
                requirement.anyOf.length === 0 || requirement.anyOf.some(code => permissions.has(code))
              );
            },
          },
        },
      ],
    });
    return TestBed.inject(DashboardLayoutStore);
  }

  function ids(store: DashboardLayoutStore): DashboardWidgetId[] {
    return store.widgets().map(widget => widget.id);
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.removeItem('tvf.dashboard.layout.v1');
  });

  it('sin permisos ni módulos solo quedan los widgets que no dependen de nada', () => {
    const store = create({ permissions: [], modules: [] });

    expect(ids(store)).toEqual(['hero', 'recent-activity']);
  });

  it('el banner PRO (side-stack) solo aparece si se puede gestionar el plan: si no, no deja hueco', () => {
    expect(ids(create({ permissions: [], modules: [], billing: true }))).toContain('side-stack');
  });

  it('con todo, están los 15 y arriba quedan hero | today y needs-attention a lo ancho', () => {
    const store = create({ permissions: ALL_PERMISSIONS, modules: ALL_MODULES, billing: true });

    expect(store.widgets().length).toBe(15);
    expect(store.widgets().slice(0, 3)).toEqual([
      { id: 'hero', colSpan: 2 },
      { id: 'today', colSpan: 1 },
      { id: 'needs-attention', colSpan: 3 },
    ]);
  });

  it('los widgets con varias fuentes se muestran si al menos una sirve', () => {
    // Solo calendario: Today tiene citas que mostrar; Needs attention no tiene ninguna fuente.
    const store = create({ permissions: ['calendar.read'], modules: ['planner'] });

    expect(ids(store)).toContain('today');
    expect(ids(store)).not.toContain('needs-attention');
    expect(ids(store)).not.toContain('analytics-stack');
  });

  it('el módulo del plan manda aunque tenga el permiso', () => {
    // Caso 2 del Anexo C dentro del panel: la oficina no contrató Client communication.
    const store = create({
      permissions: ['communication.chat.start', 'communication.meeting.create'],
      modules: [],
    });

    expect(ids(store)).not.toContain('recent-chats');
    expect(ids(store)).not.toContain('video-calls');
  });

  it('el uso de storage pide el permiso del endpoint que llama, no el de la pantalla', () => {
    // `GET /storage/usage` exige `cloudstorage.settings.manage`. Con `file.view` —lo que tiene
    // quien solo mira documentos— la tarjeta daba 403.
    const conFileView = create({ permissions: ['cloudstorage.file.view'], modules: ['documents'] });
    expect(ids(conFileView)).not.toContain('storage-usage');
    TestBed.resetTestingModule();

    const conSettings = create({ permissions: ['cloudstorage.settings.manage'], modules: ['documents'] });
    expect(ids(conSettings)).toContain('storage-usage');
  });

  // ---------- Arrastrar con widgets escondidos ----------

  it('mover usa el índice VISIBLE y mueve el widget correcto', () => {
    // El CDK entrega índices de la lista que el usuario ve. Aplicarlos sobre el orden completo
    // movería otro widget en cuanto haya uno escondido — el mismo error que tenía el pill del
    // sidebar antes de B3.
    const store = create({ permissions: [], modules: [], billing: true });
    const visible = ids(store);
    expect(visible).toEqual(['hero', 'side-stack', 'recent-activity']);

    // Mover el último visible al principio.
    store.move(2, 0);

    expect(ids(store)[0]).toBe('recent-activity');
  });

  it('el orden guardado conserva los widgets escondidos', () => {
    // Si el día que la oficina contrata el módulo el widget apareciera al final, el usuario
    // pensaría que se le desordenó el panel.
    const store = create({ permissions: [], modules: [], billing: true });
    store.move(2, 0);

    const saved = JSON.parse(localStorage.getItem('tvf.dashboard.layout.v1') ?? '[]') as string[];

    expect(saved).toContain('tasks');
    expect(saved.length).toBe(15);
  });

  it('un layout guardado antes de existir un widget lo recibe junto a su vecino, no al final', () => {
    // Orden guardado con la versión de 13 widgets, con notes movido al principio.
    const saved = [
      'notes',
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
      'unknown-widget',
    ];

    const merged = mergeSavedOrder(saved);

    expect(merged.slice(0, 4)).toEqual(['notes', 'hero', 'today', 'needs-attention']);
    expect(merged).not.toContain('unknown-widget');
    expect(merged.length).toBe(15);
  });

  // ---------- El mapa y el layout hablan el mismo idioma ----------

  it('todo widget del layout declara qué necesita', () => {
    const store = create({ permissions: [], modules: null });
    const declared = Object.keys(DASHBOARD_WIDGET_ACCESS);

    // Con `modules: null` (sin bootstrap) no se esconde nada por plan, así que están todos.
    for (const widget of store.widgets()) {
      expect(declared, `el widget "${widget.id}" no está en el mapa`).toContain(widget.id);
    }
  });
});
