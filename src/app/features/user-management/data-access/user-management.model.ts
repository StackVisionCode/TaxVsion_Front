import { TeamMember } from '../ui/user-table/user-table.component';

/** Espejo de TaxVision.Auth.Domain.Users.UserActorType (viaja como string por JsonStringEnumConverter). */
export type UserActorType = 'TenantEmployee' | 'TenantAdmin' | 'CustomerPortal' | 'PlatformAdmin';

/** Espejo de TaxVision.Auth.Domain.Invitations.InvitationStatus (query param `status` de GET /auth/invitations). */
export type InvitationStatus = 'Pending' | 'Accepted' | 'Cancelled' | 'Expired';

/** Espejo de BuildingBlocks.Common.PagedResult<T>. Campo de tamaño de página: `size`, no `pageSize`. */
export interface PagedResult<T> {
  items: T[];
  page: number;
  size: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

/** Fila de GET /auth/users y GET /auth/users/{id} (UserSummaryResponse). `roles` son nombres, no ids. */
export interface UserSummary {
  id: string;
  name: string;
  lastName: string;
  email: string;
  actorType: string;
  isActive: boolean;
  /** Ciclo de vida (UserStatus): 'Active' | 'Deactivated' | 'Offboarded'. Distingue un retiro terminal de una suspensión. */
  status: string;
  mfaEnabled: boolean;
  createdAtUtc: string;
  roles: string[];
}

/** Fila de GET /auth/invitations (InvitationResponse). El backend no expone los roleIds de la invitación. */
export interface InvitationSummary {
  id: string;
  email: string;
  actorType: string;
  status: InvitationStatus;
  createdAtUtc: string;
  expiresAtUtc: string;
  resendCount: number;
  lastSentAtUtc: string | null;
  invitedByUserId: string | null;
}

/**
 * Body de POST /auth/invitations (CreateInvitationRequest). `tenantId` es obligatorio
 * (sale de AuthService.currentUser().tenant.id). `customerId` solo aplica a invitaciones
 * CustomerPortal — para staff va null.
 */
export interface CreateInvitationRequest {
  tenantId: string;
  email: string;
  actorType: UserActorType;
  customerId: string | null;
  roleIds?: string[] | null;
}

/** Respuesta de POST /auth/invitations. `invitationToken` solo viene en dev (ReturnRawToken). */
export interface CreateInvitationResponse {
  invitationId: string;
  tenantId: string;
  email: string;
  actorType: UserActorType;
  customerId: string | null;
  invitationToken: string | null;
  expiresAtUtc: string;
}

/** GET /auth/roles (RoleResponse). */
export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissionCodes: string[];
  /**
   * Actor types del tenant a los que el rol es asignable (el backend lo deriva de los permisos del
   * rol). El picker de staff filtra por acá para no ofrecer roles que el backend rechazaría. Puede
   * venir vacío si el backend es viejo → tratar "vacío" como "no filtrar" (fallback seguro).
   */
  assignableActorTypes: UserActorType[];
}

/** GET /auth/permissions (PermissionResponse) — catálogo global, no por tenant. */
export interface PermissionInfo {
  id: string;
  code: string;
  module: string;
  description: string;
  isCustomerPortal: boolean;
}

/** GET /auth/tenants/limits (TenantLimitsResponse): plan, asientos usados/disponibles e invitaciones. */
export interface TenantLimits {
  planCode: string | null;
  maxUsers: number | null;
  activeUsers: number;
  pendingInvitations: number;
  availableSeats: number | null;
  maxPendingInvitations: number | null;
  storageQuotaBytes: number | null;
  isSuspendedForBilling: boolean;
  enabledModules: string[];
}

/** Body de PUT /auth/users/{id}/roles (AssignRolesRequest). Reemplaza el set completo de roles. */
export interface AssignRolesRequest {
  roleIds: string[];
}

// ---------- Per-user permission overrides (the RBAC deny layer) ----------

/**
 * One role-granted permission the admin can toggle for a user, from
 * GET /auth/users/{id}/effective-access. `permissionId` is what the override PUT takes; `denied` true
 * means the permission is currently blocked for this user (an OFF toggle) even though a role grants it.
 */
export interface UserAccessPermission {
  permissionId: string;
  code: string;
  module: string;
  description: string;
  denied: boolean;
}

/** The target's role-granted permissions for one module, so the drawer can render a module accordion. */
export interface UserAccessModule {
  module: string;
  permissions: UserAccessPermission[];
}

/**
 * GET /auth/users/{id}/effective-access (UserEffectiveAccessResponse) — everything the "Edit access"
 * drawer needs in one call. Only role-granted permissions appear (a deny on a permission no role grants
 * is inert and omitted); to GRANT a permission you assign a role, not this call.
 */
export interface UserEffectiveAccess {
  userId: string;
  actorType: string;
  roles: string[];
  modules: UserAccessModule[];
  permissionsVersion: number;
}

/**
 * Body of PUT /auth/users/{id}/permission-overrides (SetPermissionOverridesRequest). Deny-only,
 * replace-set: the given ids fully replace the previous deny set; an empty array clears every override.
 */
export interface SetPermissionOverridesRequest {
  deniedPermissionIds: string[];
}

// ---------- Offboarding (punto 3.2): preview de impacto + sucesor ----------

/**
 * Un renglón de la preview de impacto del retiro, ya compuesto desde el `GET /<svc>/offboarding-impact/{userId}`
 * de cada servicio. `available` es false si ese servicio no respondió (403/error/timeout) — el fan-out degrada
 * por-servicio en vez de fallar entero.
 */
export interface OffboardImpactItem {
  key: string;
  label: string;
  action: string;
  icon: string;
  count: number;
  available: boolean;
}

/** Candidato a sucesor: staff activo (no portal) distinto del que se retira, para el picker del diálogo. */
export interface EligibleSuccessor {
  id: string;
  name: string;
  subtitle: string;
}

// ---------- Adaptadores backend -> TeamMember (shape de la UI existente) ----------

const AVATAR_PALETTE = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500'];

export function pickAvatarColor(seed: string): string {
  const hash = seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
  }
  return (words[0] ?? 'NM').slice(0, 2).toUpperCase();
}

/** Turns "sofia.martinez@taxprooffice.com" into "Sofia Martinez" for invitation rows (no name yet). */
function deriveNameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const words = localPart.split(/[._\-+0-9]+/).filter(Boolean);
  if (words.length === 0) {
    return 'Invited member';
  }
  return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Etiqueta corta del actor type para chips ("Admin" / "Employee"). */
export function actorTypeLabel(actorType: string): string {
  switch (actorType) {
    case 'TenantAdmin':
      return 'Admin';
    case 'TenantEmployee':
      return 'Employee';
    case 'CustomerPortal':
      return 'Client portal';
    case 'PlatformAdmin':
      return 'Platform';
    default:
      return actorType;
  }
}

/** Fila de la tabla desde GET /auth/users. Sin "last active" en el backend: se muestra la fecha de alta. */
export function userToTeamMember(user: UserSummary): TeamMember {
  const name = `${user.name} ${user.lastName}`.trim() || user.email;
  return {
    id: user.id,
    kind: 'user',
    name,
    initials: deriveInitials(name),
    avatarColor: pickAvatarColor(user.email),
    email: user.email,
    roleNames: user.roles,
    actorType: user.actorType,
    // 'Offboarded' es terminal (Removed): distinto de una suspensión reversible; el resto por isActive.
    status: user.status === 'Offboarded' ? 'removed' : user.isActive ? 'active' : 'suspended',
    activity: `Joined ${formatDate(user.createdAtUtc)}`,
  };
}

/**
 * Fila de la tabla desde GET /auth/invitations (status Pending). El backend no devuelve los roles de
 * la invitación; el actor type se muestra con su propio badge (no como chip de rol), así que aquí
 * `roleNames` queda vacío.
 */
export function invitationToTeamMember(invitation: InvitationSummary): TeamMember {
  const name = deriveNameFromEmail(invitation.email);
  return {
    id: invitation.id,
    kind: 'invitation',
    name,
    initials: deriveInitials(name),
    avatarColor: pickAvatarColor(invitation.email),
    email: invitation.email,
    roleNames: [],
    actorType: invitation.actorType,
    status: 'invited',
    activity: `Invited ${formatDate(invitation.lastSentAtUtc ?? invitation.createdAtUtc)} · expires ${formatDate(invitation.expiresAtUtc)}`,
  };
}
