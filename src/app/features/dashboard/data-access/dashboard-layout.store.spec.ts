import { TestBed } from '@angular/core/testing';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { DashboardLayoutStore, DashboardWidgetId } from './dashboard-layout.store';
import { DASHBOARD_WIDGET_ACCESS } from './dashboard-widget-access';

/**
 * B5 — el dashboard dejaba de ser "13 tarjetas, algunas con error". Un empleado sin el módulo de
 * planner veía las suyas y, al lado, cuatro tarjetas rojas con 403 que no podía resolver.
 */
describe('DashboardLayoutStore', () => {
  function create(options: { permissions?: readonly string[]; modules?: readonly string[] | null } = {}) {
    const permissions = new Set(options.permissions ?? []);
    const modules = options.modules === undefined ? null : options.modules;

    localStorage.removeItem('tvf.dashboard.layout.v1');

    TestBed.configureTestingModule({
      providers: [
        DashboardLayoutStore,
        {
          provide: AccessStore,
          useValue: {
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

    expect(ids(store)).toEqual(['hero', 'side-stack', 'analytics-stack', 'recent-activity']);
  });

  it('con todo, están los 13', () => {
    const store = create({
      permissions: [
        'tasks.read',
        'calendar.read',
        'notes.read',
        'communication.chat.start',
        'communication.meeting.create',
        'invoicing.view',
        'cloudstorage.settings.manage',
        'signature.request.read',
        'customers.view',
      ],
      modules: ['planner', 'comms', 'documents', 'signatures', 'customers'],
    });

    expect(store.widgets().length).toBe(13);
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
    const store = create({ permissions: [], modules: [] });
    const visible = ids(store);
    expect(visible).toEqual(['hero', 'side-stack', 'analytics-stack', 'recent-activity']);

    // Mover el último visible al principio.
    store.move(3, 0);

    expect(ids(store)[0]).toBe('recent-activity');
  });

  it('el orden guardado conserva los widgets escondidos', () => {
    // Si el día que la oficina contrata el módulo el widget apareciera al final, el usuario
    // pensaría que se le desordenó el panel.
    const store = create({ permissions: [], modules: [] });
    store.move(3, 0);

    const saved = JSON.parse(localStorage.getItem('tvf.dashboard.layout.v1') ?? '[]') as string[];

    expect(saved).toContain('tasks');
    expect(saved.length).toBe(13);
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
