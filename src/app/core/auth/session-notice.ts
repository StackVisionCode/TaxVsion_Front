/**
 * El motivo por el que se volvió a /login, compartido entre quien lo escribe (el cierre forzado de
 * sesión en `app.ts`) y quien lo lee (la pantalla de login).
 *
 * Vive en un solo archivo a propósito: cuando el valor estaba escrito a mano en los dos lados, el
 * que escribía existía y el que leía no — el usuario salía disparado a login sin una sola palabra de
 * explicación. Con una constante compartida eso no se puede desincronizar sin romper la compilación.
 */
export const SESSION_EXPIRED_REASON = 'session_expired';

/** Avisos de la pantalla de login por motivo. No son errores del usuario: se pintan en tono neutro. */
export const LOGIN_NOTICES: Readonly<Record<string, string>> = {
  [SESSION_EXPIRED_REASON]: 'Your session expired. Sign in again to continue.',
};

export function loginNoticeFor(reason: string | null): string | null {
  return reason ? (LOGIN_NOTICES[reason] ?? null) : null;
}
