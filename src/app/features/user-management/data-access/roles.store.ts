import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap, throwError } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import {
  NotGrantableReason,
  PermissionInfo,
  RoleSummary,
  RoleUser,
} from './user-management.model';
import { UserManagementService } from './user-management.service';

/**
 * B9 — el CRUD de roles custom. Hasta acá no existía: crear un rol para la oficina exigía Postman,
 * y la §34 lo listaba como "No existe" (caso 6 del Anexo C: el rol TaxPreparerJunior no se podía
 * crear desde la aplicación).
 *
 * Dos decisiones del backend que este store hace visibles en vez de esconder:
 * - El catálogo trae `grantable` YA RESUELTO contra el plan del tenant. El picker no recalcula la
 *   fórmula del techo (§27): pregunta. Recalcularla acá sería una segunda verdad que se desincroniza.
 * - Los permisos van por su propio endpoint, separados del nombre y la descripción. Guardar un rol
 *   editado son dos llamadas, y este store las encadena para que la pantalla vea una sola.
 */
@Injectable()
export class RolesStore {
  private readonly service = inject(UserManagementService);

  private readonly _roles = signal<readonly RoleSummary[]>([]);
  private readonly _catalog = signal<readonly PermissionInfo[]>([]);
  private readonly _usersByRole = signal<ReadonlyMap<string, readonly RoleUser[]>>(new Map());
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly roles = this._roles.asReadonly();
  readonly catalog = this._catalog.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly error = this._error.asReadonly();

  /** Los roles de la oficina, sin los de sistema: son los únicos que se pueden editar. */
  readonly customRoles = computed(() => this._roles().filter(role => !role.isSystem));
  readonly systemRoles = computed(() => this._roles().filter(role => role.isSystem));

  /** El catálogo agrupado por módulo, que es como se presenta el picker. */
  readonly catalogByModule = computed(() => {
    const grouped = new Map<string, PermissionInfo[]>();
    for (const permission of this._catalog()) {
      // Los permisos del portal del cliente no van en un rol de staff.
      if (permission.isCustomerPortal) {
        continue;
      }
      const bucket = grouped.get(permission.module) ?? [];
      bucket.push(permission);
      grouped.set(permission.module, bucket);
    }
    return [...grouped.entries()]
      .map(([module, permissions]) => ({ module, permissions }))
      .sort((a, b) => a.module.localeCompare(b.module));
  });

  /** True cuando el catálogo llegó. Sin él no se puede traducir código → id: no se guarda a ciegas. */
  readonly catalogReady = computed(() => this._catalog().length > 0);

  /**
   * Códigos → ids, que es lo que el backend recibe (`PermissionIds`). Si algún código no está en
   * el catálogo se DEVUELVE null en vez de mandar la lista incompleta: guardar un rol con menos
   * permisos de los que el administrador eligió es peor que no guardarlo.
   */
  private toIds(codes: readonly string[]): string[] | null {
    const byCode = new Map(this._catalog().map(permission => [permission.code, permission.id]));
    const ids: string[] = [];
    for (const code of codes) {
      const id = byCode.get(code);
      if (id === undefined) {
        return null;
      }
      ids.push(id);
    }
    return ids;
  }

  usersOf(roleId: string): readonly RoleUser[] | undefined {
    return this._usersByRole().get(roleId);
  }

  load(): void {
    this._loading.set(true);
    this._error.set(null);
    this.service.getRoles().subscribe({
      next: roles => {
        this._roles.set(roles);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
    // El catálogo falla por su cuenta: sin él el picker queda vacío, pero la lista de roles se ve.
    this.service.getPermissions().subscribe({
      next: catalog => this._catalog.set(catalog),
      error: err => this._error.set(toApiError(err).message),
    });
  }

  /** Quiénes tienen el rol. Se pide al abrir la fila: desactivar a ciegas era el problema. */
  loadUsers(roleId: string): void {
    if (this._usersByRole().has(roleId)) {
      return;
    }
    this.service.getRoleUsers(roleId).subscribe({
      next: users => this._usersByRole.update(all => new Map(all).set(roleId, users)),
      error: () => this._usersByRole.update(all => new Map(all).set(roleId, [])),
    });
  }

  /** Crea el rol a partir de los CÓDIGOS elegidos en el picker; la traducción a ids ocurre acá. */
  createFromCodes(name: string, description: string | null, codes: readonly string[]): Observable<RoleSummary> {
    const ids = this.toIds(codes);
    if (ids === null) {
      return this.catalogMissing();
    }
    return this.run(this.service.createRole({ name, description, permissionIds: ids }));
  }

  /**
   * Guardar un rol existente: nombre y descripción por un endpoint, permisos por otro. Se encadenan
   * para que la pantalla no tenga que saberlo.
   */
  update(roleId: string, name: string, description: string | null, permissionCodes: readonly string[]): Observable<void> {
    const ids = this.toIds(permissionCodes);
    if (ids === null) {
      return this.catalogMissing<void>();
    }
    this._saving.set(true);
    this._error.set(null);
    return new Observable<void>(subscriber => {
      this.service.updateRole(roleId, { name, description }).subscribe({
        next: () =>
          this.service.setRolePermissions(roleId, ids).subscribe({
            next: () => {
              this._saving.set(false);
              this.load();
              subscriber.next();
              subscriber.complete();
            },
            error: err => this.fail(err, subscriber),
          }),
        error: err => this.fail(err, subscriber),
      });
    });
  }

  deactivate(roleId: string): Observable<void> {
    return this.run(this.service.deactivateRole(roleId));
  }

  reactivate(roleId: string): Observable<void> {
    return this.run(this.service.reactivateRole(roleId));
  }

  /**
   * Duplicar: el caso real es "quiero uno como éste pero sin dos cosas". Se copian solo los
   * permisos que HOY son concedibles — si el rol original tiene alguno que el plan ya no habilita,
   * el backend rechazaría la copia entera.
   */
  duplicate(role: RoleSummary): Observable<RoleSummary> {
    const grantable = new Set(
      this._catalog()
        .filter(permission => notGrantableReason(permission) === null)
        .map(permission => permission.code),
    );
    return this.createFromCodes(
      this.freeCopyName(role.name),
      role.description,
      role.permissionCodes.filter(code => grantable.has(code)),
    );
  }

  /**
   * El primer nombre libre para una copia. Duplicar dos veces el mismo rol chocaba con la
   * unicidad de nombres del backend (409) y el usuario solo veía que "no funciona".
   */
  private freeCopyName(original: string): string {
    const taken = new Set(this._roles().map(role => role.name.toLowerCase()));
    const first = `${original} (copy)`;
    if (!taken.has(first.toLowerCase())) {
      return first;
    }
    for (let n = 2; n < 100; n++) {
      const candidate = `${original} (copy ${n})`;
      if (!taken.has(candidate.toLowerCase())) {
        return candidate;
      }
    }
    return `${original} (copy)`;
  }

  /** Los permisos del rol que el plan de hoy ya no permite conceder: se avisan al duplicar. */
  droppedOnDuplicate(role: RoleSummary): string[] {
    const grantable = new Set(
      this._catalog()
        .filter(permission => notGrantableReason(permission) === null)
        .map(permission => permission.code),
    );
    return role.permissionCodes.filter(code => !grantable.has(code));
  }

  /**
   * Sin catálogo no hay forma de traducir los códigos a ids. Antes de B10 esto ni se planteaba
   * porque se mandaban los códigos — y el backend contestaba 400 `PermissionIds is required`.
   */
  private catalogMissing<T>(): Observable<T> {
    this._error.set('Could not load the permission catalog, so the role cannot be saved. Reload and try again.');
    return throwError(() => new Error('permission catalog unavailable'));
  }

  private run<T>(call: Observable<T>): Observable<T> {
    this._saving.set(true);
    this._error.set(null);
    return call.pipe(
      tap({
        next: () => {
          this._saving.set(false);
          this.load();
        },
        error: err => {
          this._error.set(toApiError(err).message);
          this._saving.set(false);
        },
      }),
    );
  }

  private fail(err: unknown, subscriber: { error(e: unknown): void }): void {
    this._error.set(toApiError(err).message);
    this._saving.set(false);
    subscriber.error(err);
  }
}

/**
 * Por qué un permiso no se puede poner en un rol custom, o null si sí se puede.
 *
 * `grantable` es la respuesta del backend y manda. Las otras banderas solo sirven para EXPLICARLO:
 * sin explicación, el administrador ve una casilla apagada y no sabe si le falta plan, si es de la
 * plataforma o si es un error. Si el backend es viejo y no manda `grantable`, se deja intentar: que
 * decida el servidor, no una suposición del cliente.
 */
export function notGrantableReason(permission: PermissionInfo): NotGrantableReason | null {
  if (permission.grantable !== false) {
    return null;
  }
  if (permission.platformOnly) {
    return 'platform';
  }
  if (permission.isDangerous) {
    return 'dangerous';
  }
  if (permission.isReserved) {
    return 'reserved';
  }
  if (permission.isAssignableByTenant === false) {
    return 'not_assignable';
  }
  // Lo que queda es el techo comercial: el tier del plan o el módulo que la oficina no contrató.
  return 'plan';
}

/** El texto que ve el administrador. En inglés, y dice qué hacer cuando hay algo que hacer. */
export function notGrantableLabel(reason: NotGrantableReason): string {
  switch (reason) {
    case 'platform':
      return 'Reserved for platform operators';
    case 'dangerous':
      return 'High risk — only the owner role can hold it';
    case 'reserved':
      return 'Declared but not in use yet';
    case 'not_assignable':
      return 'Cannot be granted from inside your office';
    case 'plan':
      return 'Not included in your plan';
  }
}
