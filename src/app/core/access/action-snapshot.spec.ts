import { TestBed } from '@angular/core/testing';
import { AccessStore } from './access.store';
import { AdminCapabilities } from './admin-capabilities';
import { DocumentsPermissions } from '@features/documents/data-access/documents-permissions';
import { SignatureCapabilities } from '@features/signature/data-access/signature-permissions';
import { CorrespondenceCapabilities } from '@features/mail/data-access/correspondence-permissions';
import { UserManagementCapabilities } from '@features/user-management/data-access/user-management-permissions';

/**
 * B6 — el snapshot de acciones por rol.
 *
 * La aceptación de la fase es "el backend ya no devuelve 403 por acciones que la UI ofreció". Eso
 * no se puede comprobar sin el backend, pero sí se puede fijar lo que la UI OFRECE para un
 * conjunto de permisos dado: si mañana alguien afloja un gate, esta lista cambia y el test lo dice.
 *
 * Los conjuntos de permisos son los del catálogo real, no inventados: el empleado trae el bundle
 * de lectura, el administrador el suyo completo.
 */
describe('acciones ofrecidas por rol', () => {
  /** Lo que un TenantEmployee típico tiene: leer casi todo, escribir su trabajo diario. */
  const EMPLEADO = [
    'customers.view',
    'cloudstorage.file.view',
    'cloudstorage.file.upload',
    'cloudstorage.file.download',
    'correspondence.read',
    'correspondence.compose',
    'correspondence.reply',
    'correspondence.send',
    'signature.request.read',
    'signature.request.create',
    'tasks.read',
    'tasks.write',
    'reminders.read',
    'reminders.write',
    'notes.read',
    'notes.manage',
  ];

  /** El administrador de la oficina: lo del empleado más lo destructivo y lo administrativo. */
  const ADMINISTRADOR = [
    ...EMPLEADO,
    'cloudstorage.file.delete',
    'cloudstorage.folder.manage',
    'cloudstorage.share.create',
    'cloudstorage.share.revoke',
    'cloudstorage.share.manage',
    'cloudstorage.recyclebin.manage',
    'cloudstorage.settings.manage',
    'correspondence.manage',
    'signature.request.cancel',
    'signature.request.expire',
    'signature.request.resend',
    'signature.template.update',
    'signature.template.delete',
    'signature.preparer.manage',
    'users.view',
    'users.invite',
    'users.manage',
    'roles.manage',
    'seats.manage',
    'branding.manage',
    'invoicing.issuer.manage',
    'payment_client.config.manage',
    'payment_client.payment_link.manage',
  ];

  function snapshot(permissions: readonly string[]): Record<string, boolean> {
    TestBed.resetTestingModule();
    const granted = new Set(permissions);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AccessStore,
          useValue: {
            can: (code: string) => granted.has(code),
            canAny: (codes: readonly string[]) => codes.some(code => granted.has(code)),
          },
        },
      ],
    });

    const documents = TestBed.inject(DocumentsPermissions);
    const signature = TestBed.inject(SignatureCapabilities);
    const mail = TestBed.inject(CorrespondenceCapabilities);
    const users = TestBed.inject(UserManagementCapabilities);
    const admin = TestBed.inject(AdminCapabilities);

    return {
      'documents: borrar archivo': documents.canDeleteFile(),
      'documents: gestionar carpetas': documents.canManageFolders(),
      'documents: compartir': documents.canShare(),
      'documents: revocar enlace': documents.canRevokeShare(),
      'documents: papelera': documents.canUseRecycleBin(),
      'documents: subir': documents.canUpload(),
      'signature: crear': signature.canCreate(),
      'signature: cancelar': signature.canCancel(),
      'signature: extender': signature.canExtend(),
      'signature: reenviar': signature.canResend(),
      'signature: plantillas': signature.canEditTemplates(),
      'mail: redactar': mail.canCompose(),
      'mail: borrar para siempre': mail.canManage(),
      'users: invitar': users.canInvite(),
      'users: suspender y dar de baja': users.canManageUsers(),
      'users: roles': users.canManageRoles(),
      'users: comprar puestos': users.canManageSeats(),
      'empresa: marca': admin.canManageBranding(),
      'empresa: perfil legal': admin.canManageIssuerProfile(),
      'cobro: proveedores': admin.canManagePaymentProviders(),
      'cobro: links de pago': admin.canManagePaymentLinks(),
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('el empleado no recibe ninguna acción destructiva ni administrativa', () => {
    expect(snapshot(EMPLEADO)).toEqual({
      'documents: borrar archivo': false,
      'documents: gestionar carpetas': false,
      'documents: compartir': false,
      'documents: revocar enlace': false,
      'documents: papelera': false,
      'documents: subir': true,
      'signature: crear': true,
      'signature: cancelar': false,
      'signature: extender': false,
      'signature: reenviar': false,
      'signature: plantillas': false,
      'mail: redactar': true,
      'mail: borrar para siempre': false,
      'users: invitar': false,
      'users: suspender y dar de baja': false,
      'users: roles': false,
      'users: comprar puestos': false,
      'empresa: marca': false,
      'empresa: perfil legal': false,
      'cobro: proveedores': false,
      'cobro: links de pago': false,
    });
  });

  it('el administrador las recibe todas', () => {
    const offered = snapshot(ADMINISTRADOR);

    expect(Object.entries(offered).filter(([, allowed]) => !allowed)).toEqual([]);
  });

  it('sin permisos no se ofrece nada', () => {
    const offered = snapshot([]);

    expect(Object.values(offered).some(Boolean)).toBe(false);
  });

  // ---------- Separaciones que el backend hace y la UI tiene que respetar ----------

  it('cancelar y extender una firma son permisos distintos', () => {
    // Darle más días a una solicitud no es matarla; el backend los separa y la UI también.
    const soloCancelar = snapshot([...EMPLEADO, 'signature.request.cancel']);

    expect(soloCancelar['signature: cancelar']).toBe(true);
    expect(soloCancelar['signature: extender']).toBe(false);
  });

  it('borrar una carpeta no es el permiso de borrar archivos', () => {
    const soloArchivos = snapshot([...EMPLEADO, 'cloudstorage.file.delete']);

    expect(soloArchivos['documents: borrar archivo']).toBe(true);
    expect(soloArchivos['documents: gestionar carpetas']).toBe(false);
  });

  it('vaciar la papelera tiene permiso propio', () => {
    const conBorrado = snapshot([...EMPLEADO, 'cloudstorage.file.delete', 'cloudstorage.folder.manage']);

    expect(conBorrado['documents: papelera']).toBe(false);
  });

  it('el perfil legal no viene con las facturas', () => {
    // `invoicing.manage` deja emitir facturas; cambiar el EIN y la razón social que se estampan en
    // todas es `invoicing.issuer.manage`.
    const conFacturas = snapshot([...EMPLEADO, 'invoicing.manage', 'invoicing.view']);

    expect(conFacturas['empresa: perfil legal']).toBe(false);
  });

  it('invitar no habilita suspender ni tocar roles', () => {
    const soloInvitar = snapshot([...EMPLEADO, 'users.view', 'users.invite']);

    expect(soloInvitar['users: invitar']).toBe(true);
    expect(soloInvitar['users: suspender y dar de baja']).toBe(false);
    expect(soloInvitar['users: roles']).toBe(false);
  });
});
