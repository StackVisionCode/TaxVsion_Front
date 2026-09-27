/**
 * Respuesta de `GET /auth/me/access` (A5), el bootstrap único: con esto y nada más se arman el
 * sidebar, los guards y los botones. Reemplaza combinar `/auth/me` + `/auth/me/effective-access` +
 * `/subscriptions/me`.
 */
export interface AccessBootstrap {
  actorType: string;
  /**
   * La unión de los roles activos MENOS los denies vigentes. Ya viene resuelto por el backend: no se
   * recompone acá. Recomponerlo en cada servicio fue justamente el bug que resucitaba los denies.
   */
  effectivePermissions: readonly string[];
  /** Módulos que el plan de la oficina habilita. */
  modules: readonly string[];
  /** El `perm_v` del usuario. Si el token trae uno menor, el backend responde 401 `Auth.TokenStale`. */
  permissionsVersion: number;
  /** Revisión del snapshot de entitlements. No viaja en el JWT: cambiar de plan no invalida tokens. */
  entitlementsRevision: number;
  /** Null para `CustomerPortal`: un cliente no tiene por qué saber del estado comercial de la oficina. */
  subscription: AccessSubscription | null;
}

export interface AccessSubscription {
  /** `active` · `billing_blocked` · `suspended`. Coincide con el corte real de acceso. */
  state: string;
  /** Sale de los permisos, nunca del actor type. */
  canManageBilling: boolean;
}

/**
 * Por qué una feature no está disponible. Es lo que decide QUÉ pantalla mostrar, y por eso se
 * distingue: `plan` lleva a una pantalla comercial y `permission` a una de acceso restringido.
 */
export type FeatureUnavailableReason = 'permission' | 'plan';

export type FeatureState = { available: true } | { available: false; reason: FeatureUnavailableReason };

export const AVAILABLE: FeatureState = { available: true };
