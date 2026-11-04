/**
 * Apariencia de un rol: el mismo nombre sale con el mismo color en la tabla de miembros (chip) y en la
 * pestaña Roles (tarjeta), así la persona asocia "naranja = ImportClients" en toda la pantalla.
 */
export interface RoleTone {
  /** Chip con borde (tabla de miembros). */
  chip: string;
  /** Cuadro con las iniciales (tarjeta de rol). */
  tile: string;
  /** Franja superior de la tarjeta. */
  bar: string;
}

const ROLE_TONES: readonly RoleTone[] = [
  { chip: 'border-indigo-200 bg-indigo-50 text-indigo-700', tile: 'bg-indigo-50 text-indigo-700 ring-indigo-100', bar: 'bg-indigo-400' },
  { chip: 'border-brand-bold/30 bg-indigo-100 text-brand-bold', tile: 'bg-indigo-100 text-brand-bold ring-brand-bold/15', bar: 'bg-brand-bold' },
  { chip: 'border-orange-200 bg-orange-50 text-orange-700', tile: 'bg-orange-50 text-orange-700 ring-orange-100', bar: 'bg-orange-400' },
  { chip: 'border-emerald-200 bg-emerald-50 text-emerald-700', tile: 'bg-emerald-50 text-emerald-700 ring-emerald-100', bar: 'bg-emerald-400' },
];

/** Color determinístico por nombre (los roles de la oficina son dinámicos, no un enum). */
export function roleTone(roleName: string): RoleTone {
  const hash = roleName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return ROLE_TONES[hash % ROLE_TONES.length];
}

/** Hasta dos iniciales del rol ("Tax Preparer Junior" → "TP", "ImportClients" → "IC"). */
export function roleInitials(label: string): string {
  const words = label
    .replace(/\(.*?\)/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

/** "client_forms" / "connectors.accounts" → "Client forms" / "Connectors". */
export function moduleLabel(module: string): string {
  const base = module.split('.')[0].replace(/[_-]+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1).toLowerCase() : module;
}
