/** Estado agregado del enlace de media que ve el usuario (banner de la sala y del mini-player). */
export type MediaLinkState = 'ok' | 'reconnecting' | 'failed';

/**
 * Política de recuperación ICE (mesh y SFU). Son defaults técnicos del cliente, no reglas de
 * negocio: cuántos `restartIce` se intentan y con qué espera. Se mantienen en un solo sitio para
 * que CRM y portal se comporten igual (la misma tabla vive en el portal; test de igualdad).
 */
export interface IceRecoveryPolicy {
  /** Reintentos de ICE antes de declarar el enlace caído. */
  readonly maxRestarts: number;
  /** Espera base entre reintentos; crece ×2 por intento. */
  readonly baseDelayMs: number;
  /** Cuánto se tolera `disconnected` antes de reiniciar (suele recuperarse solo). */
  readonly disconnectedGraceMs: number;
}

export const DEFAULT_ICE_RECOVERY_POLICY: IceRecoveryPolicy = {
  maxRestarts: 3,
  baseDelayMs: 1000,
  disconnectedGraceMs: 4000,
};

export type IceRecoveryAction = 'recovered' | 'restart-now' | 'restart-after-grace' | 'give-up' | 'none';

/**
 * Decide qué hacer ante un estado ICE/conexión. `failed` reinicia ya; `disconnected` espera la
 * gracia (muchas veces vuelve solo); agotados los reintentos se declara caído y la UI ofrece Retry.
 */
export function decideIceRecovery(state: string, restartsSoFar: number, policy: IceRecoveryPolicy = DEFAULT_ICE_RECOVERY_POLICY): IceRecoveryAction {
  switch (state) {
    case 'connected':
    case 'completed':
      return 'recovered';
    case 'failed':
      return restartsSoFar < policy.maxRestarts ? 'restart-now' : 'give-up';
    case 'disconnected':
      return restartsSoFar < policy.maxRestarts ? 'restart-after-grace' : 'give-up';
    default:
      return 'none';
  }
}

/** Espera antes del reintento n (0-based): 1 s, 2 s, 4 s… */
export function restartDelayMs(restartsSoFar: number, policy: IceRecoveryPolicy = DEFAULT_ICE_RECOVERY_POLICY): number {
  return policy.baseDelayMs * 2 ** restartsSoFar;
}

/** Resume varios enlaces en un solo estado: cualquiera caído manda; si no, cualquiera reconectando. */
export function aggregateMediaState(states: readonly MediaLinkState[]): MediaLinkState {
  if (states.includes('failed')) {
    return 'failed';
  }
  return states.includes('reconnecting') ? 'reconnecting' : 'ok';
}
