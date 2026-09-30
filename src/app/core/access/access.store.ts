import { HttpClient, HttpErrorResponse, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import { ApiConfigService } from '@core/config/api-config.service';
import { AVAILABLE, AccessBootstrap, AccessSubscription, FeatureState } from './access.model';
import { AccessRequirement, featureById, featureByRoute } from './features';

/**
 * La ÚNICA fuente de autorización del cliente. Antes cada componente leía
 * `currentUser().permissions` por su cuenta y contestaba a su manera; acá se pregunta una sola vez y
 * todos obtienen la misma respuesta.
 *
 * Dos cosas que no hace, a propósito:
 * - **No recompone permisos.** `effectivePermissions` ya viene con los denies aplicados. Recomponer
 *   la unión de roles en el cliente resucitaría un permiso que un administrador quitó.
 * - **No autoriza.** Oculta y adapta la UI; quien deniega es el backend. Si algo se escapa acá, el
 *   servidor responde 403 igual.
 */
@Injectable({ providedIn: 'root' })
export class AccessStore {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly auth = inject(AuthService);

  private readonly bootstrap = signal<AccessBootstrap | null>(null);
  private readonly eTag = signal<string | null>(null);

  /** True cuando el bootstrap contestó al menos una vez. Hasta entonces se usa el respaldo. */
  readonly loaded = computed(() => this.bootstrap() !== null);

  /**
   * Respaldo mientras `/auth/me/access` no esté disponible: los permisos del perfil de sesión. Sin
   * esto, un backend todavía sin A5 desplegada dejaría al usuario con CERO permisos y la UI entera
   * vacía — un frontend nuevo no puede exigir un backend nuevo para funcionar.
   */
  private readonly fallbackPermissions = computed(() => this.auth.currentUser()?.permissions ?? []);

  private readonly permissionSet = computed(
    () => new Set(this.bootstrap()?.effectivePermissions ?? this.fallbackPermissions()),
  );

  /**
   * Null mientras no haya bootstrap: "no sé qué módulos tiene el plan", que NO es lo mismo que "no
   * tiene ninguno". Sin bootstrap no se esconde nada por plan — igual que hoy, donde el gate de
   * módulo del backend está en log-only.
   */
  private readonly moduleSet = computed(() => {
    const modules = this.bootstrap()?.modules;
    return modules ? new Set(modules) : null;
  });

  /**
   * Los módulos que el plan habilita, o null mientras no se sepa. Se expone para las pantallas que
   * necesitan explicar el plan (B9 marca los permisos dormidos), no para decidir accesos — eso es
   * `canUse`, que ya trata el null con el criterio correcto.
   */
  readonly enabledModules: Signal<ReadonlySet<string> | null> = computed(() => this.moduleSet());

  readonly actorType: Signal<string | null> = computed(
    () => this.bootstrap()?.actorType ?? this.auth.currentUser()?.actorType ?? null,
  );

  readonly isAdmin: Signal<boolean> = computed(() => {
    const actor = this.actorType();
    return actor === 'TenantAdmin' || actor === 'PlatformAdmin';
  });

  readonly subscription: Signal<AccessSubscription | null> = computed(
    () => this.bootstrap()?.subscription ?? null,
  );

  readonly permissionsVersion: Signal<number | null> = computed(
    () => this.bootstrap()?.permissionsVersion ?? null,
  );

  // ---------- Preguntas ----------

  can(permission: string): boolean {
    return this.permissionSet().has(permission);
  }

  canAny(permissions: readonly string[]): boolean {
    if (permissions.length === 0) {
      return true;
    }
    const granted = this.permissionSet();
    return permissions.some(permission => granted.has(permission));
  }

  canAll(permissions: readonly string[]): boolean {
    const granted = this.permissionSet();
    return permissions.every(permission => granted.has(permission));
  }

  /** Sin bootstrap se responde `true`: no se oculta por un plan que todavía no se conoce. */
  moduleEnabled(module: string | null): boolean {
    if (module === null) {
      return true;
    }
    const modules = this.moduleSet();
    return modules === null || modules.has(module);
  }

  /**
   * El estado de una feature y, si no está, POR QUÉ. La razón es lo que separa la pantalla comercial
   * de la de acceso restringido; el plan se mira primero porque es la explicación más útil: de nada
   * sirve pedirle un permiso al administrador para un módulo que la oficina no contrató.
   */
  stateOf(feature: AccessRequirement): FeatureState {
    if (!this.moduleEnabled(feature.module)) {
      return { available: false, reason: 'plan' };
    }
    return this.canAny(feature.anyOf) ? AVAILABLE : { available: false, reason: 'permission' };
  }

  canUse(feature: AccessRequirement): boolean {
    return this.stateOf(feature).available;
  }

  /** Por ruta, para el guard, que trabaja con rutas y no con objetos. */
  canUseRoute(route: string): boolean {
    const feature = featureByRoute(route);
    return feature ? this.canUse(feature) : true;
  }

  /**
   * Por id del registro, para el menu y la grilla de settings. Un id que no esta en el registro
   * se muestra: una entrada nueva no puede desaparecer por un typo. Que el id exista lo cuida un
   * test de fitness, no un escondite en tiempo de ejecucion.
   */
  canUseId(id: string | undefined): boolean {
    if (!id) {
      return true;
    }
    const feature = featureById(id);
    return feature ? this.canUse(feature) : true;
  }

  /**
   * Quien puede gestionar el plan y los pagos. Sale de los PERMISOS, nunca del actor type: un
   * administrador sin `billing.view` no gestiona nada, y un empleado con el permiso si.
   *
   * Mientras A5 no mande `subscription`, se responde con el permiso directo. El `isAdmin()` de
   * antes se cae a proposito: era la regla equivocada, no un respaldo.
   */
  readonly canManageBilling: Signal<boolean> = computed(() => {
    const subscription = this.subscription();
    return subscription ? subscription.canManageBilling : this.can('billing.view');
  });

  // ---------- Carga ----------

  /**
   * Pide el bootstrap. Silenciosa por diseño: si falla —backend sin A5, red caída, 403 de superficie—
   * se sigue con el respaldo en vez de dejar la aplicación sin permisos.
   *
   * Manda `If-None-Match`, así que se puede llamar en cada navegación: un 304 no trae cuerpo.
   */
  /**
   * Pide el bootstrap CONDICIONAL: manda `If-None-Match`, así una comprobación rutinaria cuesta un
   * 304 sin cuerpo en vez de las ~140 permissions enteras. Devuelve la promesa para que B8 sepa
   * cuándo contestó.
   */
  load(): Promise<void> {
    return this.request();
  }

  /**
   * Resuelve cuando el bootstrap ya contestó al menos una vez, haya salido bien o mal. Es lo que
   * espera el guard de B4: sin esto, una URL directa se evalúa mientras la respuesta viaja, con
   * cero permisos en mano, y el usuario termina en `/forbidden` en cada recarga dura.
   *
   * No dispara una segunda petición: se engancha a la que arrancó el inicializador.
   */
  ready(): Promise<void> {
    return this.settled ? Promise.resolve() : this.request();
  }

  /**
   * Vuelve a pedirlo ignorando el ETag. Devuelve una promesa porque B8 necesita saber CUÁNDO llegó:
   * después de cada refresco hay que revisar si el usuario todavía puede estar en la pantalla en la
   * que está.
   */
  reload(): Promise<void> {
    this.eTag.set(null);
    return this.request();
  }

  /** La petición en vuelo, para que varios `ready()` simultáneos compartan una sola. */
  private inFlight: Promise<void> | null = null;
  private settled = false;

  private request(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const headers = this.eTag() ? new HttpHeaders({ 'If-None-Match': this.eTag()! }) : undefined;

    // Siempre resuelve, nunca rechaza: un bootstrap que falla no puede dejar una navegación
    // colgada. El respaldo ya cubre ese caso.
    const promise = new Promise<void>(resolve => {
      // Cerrar el ciclo ACÁ, y no en un `.then` encadenado, evita que dos `ready()` simultáneos
      // vean estados distintos: cuando cualquiera de los dos despierta, las banderas ya están.
      const done = () => {
        this.inFlight = null;
        this.settled = true;
        resolve();
      };

      this.http
        .get<AccessBootstrap>(`${this.api.tenantUrl('/auth/me/access')}`, { headers, observe: 'response' })
        .subscribe({
          next: (response: HttpResponse<AccessBootstrap>) => {
            const eTag = response.headers.get('ETag');
            if (eTag) {
              this.eTag.set(eTag);
            }
            // 304: el contenido no cambió, lo que ya está en memoria sigue siendo válido.
            if (response.status !== 304 && response.body) {
              this.bootstrap.set(response.body);
            }
            done();
          },
          error: (err: HttpErrorResponse) => {
            // 304 llega por el canal de error en algunos navegadores/proxies: no es un fallo.
            if (err.status !== 304) {
              this.bootstrap.set(this.bootstrap());
            }
            done();
          },
        });
    });

    this.inFlight = promise;
    return promise;
  }

  /**
   * Para un cierre de sesión que NO recargue la página. Los de hoy hacen recarga dura y destruyen el
   * store solos; se deja para que un logout por navegación no herede los accesos del saliente.
   */
  clear(): void {
    this.bootstrap.set(null);
    this.eTag.set(null);
    this.inFlight = null;
    this.settled = false;
  }
}
