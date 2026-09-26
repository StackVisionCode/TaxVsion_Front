import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PermissionService } from '@core/auth/permission.service';
import { ToastService } from '../../../../shared/ui/toast/toast.service';
import { UserManagementService } from '../../../user-management/data-access/user-management.service';
import { UserEffectiveAccess } from '../../../user-management/data-access/user-management.model';
import { ClientPortalPermissionsComponent } from './client-portal-permissions.component';

const ACCESS: UserEffectiveAccess = {
  userId: 'portal-user-1',
  actorType: 'CustomerPortal',
  roles: ['Customer Portal'],
  permissionsVersion: 3,
  modules: [
    {
      module: 'portal',
      permissions: [
        { permissionId: 'p1', code: 'portal.folders.view', module: 'portal', description: '', denied: false },
      ],
    },
    {
      module: 'cloudstorage',
      permissions: [
        { permissionId: 'p2', code: 'cloudstorage.file.download', module: 'cloudstorage', description: '', denied: true },
        { permissionId: 'p3', code: 'cloudstorage.file.upload', module: 'cloudstorage', description: '', denied: false },
      ],
    },
  ],
};

/**
 * El acceso de un cliente al portal se edita en su perfil, no en la pantalla de equipo: un cliente no
 * es compañero de oficina. Acá se fija que la sección carga lo suyo, guarda el set completo de denegados
 * y no aparece sin permiso.
 */
describe('ClientPortalPermissionsComponent', () => {
  function create(options: { canManage?: boolean; catalogFails?: boolean } = {}) {
    const saved: string[][] = [];
    const usersStub = {
      getEffectiveAccess: () => of(structuredClone(ACCESS)),
      getPermissions: () =>
        options.catalogFails
          ? throwError(() => new Error('403'))
          : of([
              { id: 'p9', code: 'portal.miles.use', module: 'portal', description: '', isCustomerPortal: true },
              { id: 'p8', code: 'customers.view', module: 'customers', description: '', isCustomerPortal: false },
            ]),
      setPermissionOverrides: (_userId: string, denied: string[]) => {
        saved.push([...denied].sort());
        return of(undefined);
      },
    };
    TestBed.configureTestingModule({
      imports: [ClientPortalPermissionsComponent],
      providers: [
        { provide: UserManagementService, useValue: usersStub },
        { provide: PermissionService, useValue: { has: () => options.canManage !== false } },
        { provide: ToastService, useValue: { success: () => undefined, error: () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(ClientPortalPermissionsComponent);
    fixture.componentRef.setInput('userId', 'portal-user-1');
    fixture.componentRef.setInput('clientName', 'Ada Lovelace');
    fixture.detectChanges();
    return { component: fixture.componentInstance, page: fixture.nativeElement as HTMLElement, saved };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('parte del estado guardado: lo ya denegado llega marcado', () => {
    const { component } = create();

    expect(component.isDenied('p2')).toBe(true);
    expect(component.isDenied('p1')).toBe(false);
    expect(component.dirty()).toBe(false);
  });

  it('guarda el set completo de denegados, no solo el cambio', () => {
    const { component, saved } = create();

    component.setAllowed('p1', false);
    expect(component.dirty()).toBe(true);
    component.save();

    expect(saved).toEqual([['p1', 'p2']]);
    expect(component.dirty()).toBe(false);
  });

  it('el interruptor del módulo restringe todas sus capacidades de una', () => {
    const { component } = create();
    const storage = component.modules().find(m => m.key === 'cloudstorage')!;

    component.setModuleAllowed(storage, false);

    expect(component.isDenied('p2')).toBe(true);
    expect(component.isDenied('p3')).toBe(true);
    expect(component.moduleAllowed(storage)).toBe(false);
  });

  it('descartar vuelve a lo que estaba guardado', () => {
    const { component } = create();

    component.setAllowed('p1', false);
    component.discard();

    expect(component.dirty()).toBe(false);
    expect(component.isDenied('p1')).toBe(false);
  });

  // El catálogo solo aporta las filas bloqueadas; sin él la sección sigue sirviendo.
  it('sin catálogo no muestra bloqueadas pero sigue editable', () => {
    const { component } = create({ catalogFails: true });

    const portal = component.modules().find(m => m.key === 'portal')!;
    expect(portal.rows.every(row => !row.locked)).toBe(true);
  });

  it('muestra como bloqueada la capacidad de portal que el rol no concede', () => {
    const { component } = create();

    const portal = component.modules().find(m => m.key === 'portal')!;
    expect(portal.rows.find(row => row.code === 'portal.miles.use')?.locked).toBe(true);
    expect(portal.rows.some(row => row.code === 'customers.view')).toBe(false);
  });

  it('sin roles.manage no se renderiza nada', () => {
    const { page } = create({ canManage: false });

    expect(page.textContent).not.toContain('What this client can do');
  });
});
