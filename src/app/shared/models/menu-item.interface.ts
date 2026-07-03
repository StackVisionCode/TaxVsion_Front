export interface SubMenuItem {
  label: string;
  route: string;
  badge?: string | number;
  requiredPermissions?: string[];
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
  badge?: boolean;
  isSpecial?: boolean; // Para elementos especiales como AI
  requiredPermissions?: string[];
  visibleForRoles?: string[];
  showTooltip?: boolean; // Para controlar la visibilidad del tooltip
  tooltipX?: number; // Posición X del tooltip (viewport)
  tooltipY?: number; // Posición Y del tooltip (viewport)
}
