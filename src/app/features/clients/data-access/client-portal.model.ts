/**
 * Espejo del contrato de "Portal access" del perfil de cliente. El acceso al portal de un cliente
 * se compone de dos servicios:
 *  - Invitar: Customer.Api `POST /customers/{id}/portal-invitations` (perm `customers.manage` + admin).
 *  - Estado + gestión: Auth.Api — invitaciones y usuarios de portal, ahora filtrables por
 *    `?customerId=` (campo `customerId` expuesto en ambos DTOs; cambio de backend de esta fase).
 *
 * No hay un endpoint único de "estado de portal": se deriva de (a) si existe un USUARIO de portal
 * del cliente (aceptó) y (b) si hay una INVITACIÓN pendiente. Los enums viajan como STRING.
 */

export interface PagedResult<T> {
  items: T[];
  page: number;
  size: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

/** Espejo de InvitationStatus (Auth.Domain). */
export type InvitationStatus = 'Pending' | 'Accepted' | 'Cancelled' | 'Expired';

/** Espejo de InvitationResponse (con `customerId`, agregado en esta fase). */
export interface InvitationResponse {
  id: string;
  email: string;
  actorType: string;
  status: InvitationStatus;
  createdAtUtc: string;
  expiresAtUtc: string;
  resendCount: number;
  lastSentAtUtc: string | null;
  invitedByUserId: string | null;
  customerId: string | null;
}

/** Espejo de UserSummaryResponse (con `customerId`, agregado en esta fase). */
export interface PortalUserResponse {
  id: string;
  name: string;
  lastName: string;
  email: string;
  actorType: string;
  isActive: boolean;
  mfaEnabled: boolean;
  createdAtUtc: string;
  roles: string[];
  customerId: string | null;
}

/** Respuesta de `POST /customers/{id}/portal-invitations` (202). */
export interface RequestPortalInvitationResponse {
  customerId: string;
  email: string;
  status: string;
}

// ---------- Estado derivado ----------

/**
 * Estado del acceso al portal, derivado de invitaciones + usuario:
 *  - active: existe usuario de portal activo (aceptó la invitación).
 *  - deactivated: existe usuario de portal pero desactivado.
 *  - pending: hay una invitación pendiente (aún no aceptada), sin usuario.
 *  - expired: la última invitación caducó/se canceló y no hay usuario.
 *  - not-invited: nunca se invitó (o no queda rastro).
 */
export type PortalAccessStatus = 'active' | 'deactivated' | 'pending' | 'expired' | 'not-invited';

export interface PortalAccess {
  status: PortalAccessStatus;
  /** Email de login del portal (= email primario del cliente). */
  email: string | null;
  /** Invitación pendiente relevante (para reenviar/cancelar). */
  pendingInvitationId: string | null;
  /** Usuario de portal (para activar/desactivar). */
  portalUserId: string | null;
  invitedAtUtc: string | null;
  expiresAtUtc: string | null;
  resendCount: number;
  /** Reenvíos restantes (el backend tope en 5). */
  resendsLeft: number;
}

const MAX_RESENDS = 5;

/** Deriva el estado a partir de las invitaciones + usuarios del cliente (más recientes primero). */
export function derivePortalAccess(
  invitations: InvitationResponse[],
  users: PortalUserResponse[],
  fallbackEmail: string,
): PortalAccess {
  const portalUser = users.find(u => u.actorType === 'CustomerPortal') ?? users[0] ?? null;
  const pending = invitations.find(inv => inv.status === 'Pending') ?? null;
  const latest = invitations[0] ?? null;

  let status: PortalAccessStatus;
  if (portalUser) {
    status = portalUser.isActive ? 'active' : 'deactivated';
  } else if (pending) {
    status = 'pending';
  } else if (latest) {
    status = 'expired'; // cancelada o caducada, sin usuario
  } else {
    status = 'not-invited';
  }

  return {
    status,
    email: portalUser?.email ?? pending?.email ?? latest?.email ?? fallbackEmail ?? null,
    pendingInvitationId: pending?.id ?? null,
    portalUserId: portalUser?.id ?? null,
    invitedAtUtc: pending?.createdAtUtc ?? latest?.createdAtUtc ?? null,
    expiresAtUtc: pending?.expiresAtUtc ?? null,
    resendCount: pending?.resendCount ?? 0,
    resendsLeft: Math.max(0, MAX_RESENDS - (pending?.resendCount ?? 0)),
  };
}

export function portalStatusLabel(status: PortalAccessStatus): string {
  switch (status) {
    case 'active':
      return 'Portal active';
    case 'deactivated':
      return 'Portal deactivated';
    case 'pending':
      return 'Invitation pending';
    case 'expired':
      return 'Invitation expired';
    case 'not-invited':
      return 'No portal access';
  }
}

export function portalStatusChipClass(status: PortalAccessStatus): string {
  switch (status) {
    case 'active':
      return 'border-emerald-200 bg-emerald-50 text-emerald-600';
    case 'pending':
      return 'border-amber-200 bg-amber-50 text-amber-600';
    case 'deactivated':
    case 'expired':
      return 'border-red-200 bg-red-50 text-red-500';
    case 'not-invited':
      return 'border-gray-200 bg-gray-50 text-gray-500';
  }
}
