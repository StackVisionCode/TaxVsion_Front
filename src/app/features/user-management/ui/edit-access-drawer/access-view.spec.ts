import { buildAccessView } from './access-view';
import { PermissionInfo, UserAccessModule } from '../../data-access/user-management.model';

function perm(id: string, code: string, module: string, isCustomerPortal = false): PermissionInfo {
  return { id, code, module, description: code, isCustomerPortal };
}

/**
 * The view builder is what makes the drawer honest: it shows the granted permissions (toggleable) plus
 * the ones no role grants (locked, "not in their roles"), filtered to the seat's actor type. Getting this
 * wrong would either hide a capability the admin can restrict or offer to "restrict" something a role
 * never granted.
 */
describe('buildAccessView', () => {
  const grantedModules: UserAccessModule[] = [
    {
      module: 'tasks',
      permissions: [
        { permissionId: 'p-task-view', code: 'tasks.view', module: 'tasks', description: 'View tasks', denied: false },
        { permissionId: 'p-task-del', code: 'tasks.delete', module: 'tasks', description: 'Delete tasks', denied: true },
      ],
    },
  ];

  it('adds catalog permissions no role grants as locked rows in the same module', () => {
    const catalog = [
      perm('p-task-view', 'tasks.view', 'tasks'),
      perm('p-task-del', 'tasks.delete', 'tasks'),
      perm('p-task-archive', 'tasks.archive', 'tasks'), // exists but not granted -> locked
    ];

    const view = buildAccessView(grantedModules, catalog, 'TenantEmployee');

    const tasks = view.find(module => module.key === 'tasks')!;
    const archive = tasks.rows.find(row => row.code === 'tasks.archive')!;
    expect(archive.locked).toBe(true);
    expect(tasks.rows.filter(row => !row.locked).map(row => row.code)).toEqual(['tasks.delete', 'tasks.view']);
    // Locked rows come after granted rows.
    expect(tasks.rows[tasks.rows.length - 1].code).toBe('tasks.archive');
  });

  it('does not show a portal-only permission as locked on a staff seat', () => {
    const catalog = [
      perm('p-task-view', 'tasks.view', 'tasks'),
      perm('p-task-del', 'tasks.delete', 'tasks'),
      perm('p-portal', 'tasks.portalthing', 'tasks', true), // portal-only
    ];

    const view = buildAccessView(grantedModules, catalog, 'TenantEmployee');

    const tasks = view.find(module => module.key === 'tasks')!;
    expect(tasks.rows.some(row => row.code === 'tasks.portalthing')).toBe(false);
  });

  it('gives a known module a friendly English label and a mapped icon', () => {
    const view = buildAccessView(grantedModules, [], 'TenantEmployee');
    const tasks = view.find(module => module.key === 'tasks')!;
    expect(tasks.label).toBe('Tasks');
    expect(tasks.icon).toBe('tasks');
  });

  it('falls back to a title-cased label and default icon for an unmapped module', () => {
    const modules: UserAccessModule[] = [
      {
        module: 'widget_shop',
        permissions: [
          { permissionId: 'p1', code: 'widget_shop.view', module: 'widget_shop', description: 'View', denied: false },
        ],
      },
    ];

    const view = buildAccessView(modules, [], 'TenantEmployee');

    expect(view[0].label).toBe('Widget Shop');
    expect(view[0].icon).toBe('default');
  });

  it('only lists modules the user already has at least one granted permission in', () => {
    const catalog = [
      perm('p-task-view', 'tasks.view', 'tasks'),
      perm('p-task-del', 'tasks.delete', 'tasks'),
      perm('p-bill-view', 'billing.view', 'billing'), // whole module ungranted -> not shown
    ];

    const view = buildAccessView(grantedModules, catalog, 'TenantEmployee');

    expect(view.map(module => module.key)).toEqual(['tasks']);
  });

  it('labels rows in English from the code, ignoring the Spanish backend description', () => {
    const modules: UserAccessModule[] = [
      {
        module: 'cloudstorage',
        permissions: [
          {
            permissionId: 'p1',
            code: 'cloudstorage.file.download',
            module: 'cloudstorage',
            description: 'Descargar archivos disponibles', // Spanish, from the backend — must not be shown
            denied: false,
          },
          {
            permissionId: 'p2',
            code: 'customers.view',
            module: 'cloudstorage',
            description: 'Ver clientes',
            denied: false,
          },
        ],
      },
    ];

    const view = buildAccessView(modules, [], 'TenantEmployee');

    expect(view[0].label).toBe('Files & storage');
    const labels = view[0].rows.map(row => row.label);
    expect(labels).toContain('Download file');
    expect(labels).toContain('View customers');
  });

  // ---------- B9: permisos dormidos ----------

  it('marca como dormido el permiso cuyo módulo el plan no habilita', () => {
    // El rol se lo concede y el backend lo tiene, pero hoy no hace nada. Marcarlo evita la pregunta
    // "¿por qué tiene este permiso y no funciona?" — y esconderlo la haría peor.
    const granted = [
      {
        module: 'campaigns',
        permissions: [
          { permissionId: 'p1', code: 'campaigns.view', module: 'campaigns', description: 'See campaigns', denied: false },
        ],
      },
    ];
    const catalog = [
      {
        id: 'p1',
        code: 'campaigns.view',
        module: 'campaigns',
        description: 'See campaigns',
        isCustomerPortal: false,
        gateModule: 'campaigns',
      },
    ];

    const view = buildAccessView(granted, catalog, 'TenantEmployee', new Set(['customers']));

    expect(view[0].rows[0].dormant).toBe(true);
  });

  it('con el módulo contratado no está dormido', () => {
    const granted = [
      {
        module: 'campaigns',
        permissions: [
          { permissionId: 'p1', code: 'campaigns.view', module: 'campaigns', description: 'See campaigns', denied: false },
        ],
      },
    ];
    const catalog = [
      {
        id: 'p1',
        code: 'campaigns.view',
        module: 'campaigns',
        description: 'See campaigns',
        isCustomerPortal: false,
        gateModule: 'campaigns',
      },
    ];

    const view = buildAccessView(granted, catalog, 'TenantEmployee', new Set(['campaigns']));

    expect(view[0].rows[0].dormant).toBe(false);
  });

  it('sin saber los módulos del plan, no se marca nada', () => {
    // "Todavía no sé" no es "no lo tiene": inventar un "Dormant" sería peor que no decir nada.
    const granted = [
      {
        module: 'campaigns',
        permissions: [
          { permissionId: 'p1', code: 'campaigns.view', module: 'campaigns', description: 'See campaigns', denied: false },
        ],
      },
    ];
    const catalog = [
      {
        id: 'p1',
        code: 'campaigns.view',
        module: 'campaigns',
        description: 'See campaigns',
        isCustomerPortal: false,
        gateModule: 'campaigns',
      },
    ];

    const view = buildAccessView(granted, catalog, 'TenantEmployee', null);

    expect(view[0].rows[0].dormant).toBe(false);
  });

  it('un permiso transversal nunca está dormido', () => {
    const granted = [
      {
        module: 'profile',
        permissions: [
          { permissionId: 'p1', code: 'profile.read', module: 'profile', description: 'See profile', denied: false },
        ],
      },
    ];
    const catalog = [
      { id: 'p1', code: 'profile.read', module: 'profile', description: 'See profile', isCustomerPortal: false, gateModule: null },
    ];

    const view = buildAccessView(granted, catalog, 'TenantEmployee', new Set([]));

    expect(view[0].rows[0].dormant).toBe(false);
  });
});
