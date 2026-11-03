/**
 * Nombres que ve la gente para los tipos de actor y los roles de sistema. Los valores internos
 * (`TenantAdmin`, el rol "Tenant Admin"…) siguen viajando tal cual al backend, que identifica los
 * roles de sistema por su nombre: aquí solo se traduce lo que se pinta.
 */

const ACTOR_LABELS: Record<string, string> = {
  TenantAdmin: 'Admin',
  TenantEmployee: 'Employee',
  CustomerPortal: 'Client',
  PlatformAdmin: 'Platform admin',
  Guest: 'Guest',
};

/** Nombres de los roles de sistema del backend (Auth `Role.System*`). */
const SYSTEM_ROLE_LABELS: Record<string, string> = {
  'tenant admin': 'Admin',
  employee: 'Employee',
  'customer portal': 'Client',
};

/** "TenantAdmin" → "Admin"; uno desconocido se humaniza sin el prefijo "Tenant". */
export function actorTypeLabel(actorType: string | null | undefined, fallback = 'Member'): string {
  if (!actorType) return fallback;
  return ACTOR_LABELS[actorType] ?? humanize(actorType.replace(/^Tenant(?=[A-Z])/, ''));
}

/**
 * "Tenant Admin" → "Admin", "Customer Portal" → "Client"; los roles propios de la oficina quedan igual.
 * La sesión (`/auth/me`) trae el rol como identificador ("TenantAdmin"): también se traduce.
 */
export function roleLabel(roleName: string | null | undefined): string {
  const name = (roleName ?? '').trim();
  return SYSTEM_ROLE_LABELS[name.toLowerCase()] ?? ACTOR_LABELS[name] ?? name;
}

function humanize(value: string): string {
  const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : value;
}
