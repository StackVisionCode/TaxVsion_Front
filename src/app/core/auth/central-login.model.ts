/**
 * Login central multi-tenant (app.taxproffice.com): el usuario entra con email+password sin
 * saber su subdominio, y el backend lo autentica contra TODAS sus oficinas. Contrato de los 3
 * endpoints anónimos de Auth (discover-login → session/handoff → session/from-ticket).
 */

/** Una oficina donde el password calzó, ofrecible en el selector. */
export interface DiscoverOffice {
  tenantId: string;
  subdomain: string;
  tenantName: string;
  mfaRequired: boolean;
  /** El usuario en esta oficina es un cliente (CustomerPortal) → destino portal, no CRM. */
  isClientPortal: boolean;
}

/**
 * Respuesta polimórfica de POST /auth/discover-login: o una sola oficina sin MFA y ya viaja el
 * vale (subdomain + ticket), o hace falta elegir/hacer MFA (discoverySessionRef + offices).
 */
export interface DiscoverLoginResponse {
  subdomain: string | null;
  ticket: string | null;
  discoverySessionRef: string | null;
  offices: DiscoverOffice[] | null;
  /** Solo en el desenlace directo: el usuario es un cliente (CustomerPortal). */
  isClientPortal: boolean | null;
}

/** Respuesta de POST /auth/session/handoff: subdominio destino + vale de un solo uso. */
export interface HandoffTicketView {
  subdomain: string;
  ticket: string;
}

/**
 * Respuesta de POST /auth/session/from-ticket: tokens de la sesión + si el usuario debe enrolar MFA
 * (política sin método), para que el frontend fuerce el setup igual que el login directo.
 */
export interface HandoffSession {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  mfaSetupRequired: boolean;
}

/** Desenlace del discover ya interpretado por el servicio (el componente solo enruta). */
export type DiscoverOutcome =
  | { kind: 'direct'; subdomain: string; ticket: string; isClientPortal: boolean }
  | { kind: 'select'; sessionRef: string; offices: DiscoverOffice[] };
