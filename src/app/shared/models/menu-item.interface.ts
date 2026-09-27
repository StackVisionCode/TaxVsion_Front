export interface SubMenuItem {
  label: string;
  route: string;
  badge?: string | number;
  /** Id del registro `core/access/features`. Sin esto, la entrada se ve siempre. */
  featureId?: string;
}

export interface MenuItem {
  label: string;
  link?: string;
  route?: string;
  icon?: string;
  // Optional inline SVG icon markup for custom icons
  svgIcon?: string;
  items?: MenuItem[];
  hasSubmenu?: boolean;
  submenu?: SubMenuItem[];
  isOpen?: boolean;
  isActive?: boolean;
  /** Conteo para el badge (p. ej. no-leídos del chat). Undefined/0 = sin badge. */
  badge?: number;
  isSpecial?: boolean; // Para elementos especiales como AI
  /**
   * Id del registro `core/access/features`, que es quien sabe qué módulo y qué permissions hacen
   * falta. El menú declara la feature, no la regla: cuando la regla vivía acá, el sidebar y el
   * guard contestaban distinto a la misma pregunta. Sin esto, la entrada se ve siempre.
   */
  featureId?: string;
  visibleForRoles?: string[];
  showTooltip?: boolean; // Para controlar la visibilidad del tooltip
  tooltipX?: number; // Posición X del tooltip (viewport)
  tooltipY?: number; // Posición Y del tooltip (viewport)
}
