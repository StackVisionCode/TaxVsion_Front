import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { StatusPillComponent, StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { actorTypeLabel } from '../../data-access/user-management.model';

export type MemberStatus = 'active' | 'invited' | 'suspended' | 'removed';

/**
 * Fila de la tabla del equipo. Cubre dos orígenes reales:
 * - `kind: 'user'`      → GET /auth/users (UserSummaryResponse); `roleNames` son los roles del tenant.
 * - `kind: 'invitation'`→ GET /auth/invitations?status=Pending (InvitationResponse); status siempre 'invited'.
 * `activity` es el texto ya formateado de la última columna ("Joined …" / "Invited … · expires …") —
 * el backend no expone "last active".
 */
export interface TeamMember {
  id: string;
  kind: 'user' | 'invitation';
  name: string;
  initials: string;
  avatarColor: string;
  email: string;
  roleNames: string[];
  actorType: string;
  status: MemberStatus;
  activity: string;
}

const ROLE_CHIP_PALETTE = [
  'border-indigo-200 bg-indigo-50 text-indigo-700',
  'border-brand-bold/30 bg-indigo-100 text-brand-bold',
  'border-orange-200 bg-orange-50 text-orange-700',
  'border-emerald-200 bg-emerald-50 text-emerald-700',
];

/**
 * Tabla de miembros del equipo (patrón "pill header" de service-catalog):
 * cabecera con fondo suave y filas redondeadas. Cada fila tiene un menú "..."
 * cuyo contenido depende del origen: usuarios → Edit roles / Suspend-Reactivate
 * (PATCH deactivate/reactivate); invitaciones → Resend / Cancel invite. La fila
 * del usuario logueado (`currentUserId`) no muestra menú — nadie se suspende ni
 * se recorta roles a sí mismo desde acá. El menú es el `app-dropdown-menu` compartido
 * (cierra al pulsar fuera, con Escape o al elegir una acción).
 */
@Component({
  selector: 'app-user-table',
  imports: [CommonModule, AvatarComponent, DropdownMenuComponent, MenuItemDirective, StateBlockComponent, StatusPillComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './user-table.component.html',
})
export class UserTableComponent {
  @Input() members: TeamMember[] = [];
  @Input() currentUserId: string | null = null;
  @Input() emptyMessage = 'No team members found';
  /**
   * B6 — cada acción de fila con su permiso. Los cuatro son distintos en el backend: reenviar una
   * invitación es `users.invite`, suspender y dar de baja es `users.manage`, y tocar roles es
   * `roles.manage`.
   */
  @Input() canInvite = true;
  @Input() canManageUsers = true;
  @Input() canManageRoles = true;

  @Output() editRoles = new EventEmitter<TeamMember>();
  @Output() resendInvite = new EventEmitter<TeamMember>();
  @Output() toggleSuspend = new EventEmitter<TeamMember>();
  @Output() offboard = new EventEmitter<TeamMember>();
  @Output() cancelInvite = new EventEmitter<TeamMember>();

  /** Chip determinístico por nombre de rol (los roles del tenant son dinámicos, no un enum fijo). */
  roleChip(roleName: string): string {
    const hash = roleName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return ROLE_CHIP_PALETTE[hash % ROLE_CHIP_PALETTE.length];
  }

  /** Etiqueta del actor type (nivel de acceso, no un rol): "Admin" / "Employee" / "Client portal". */
  actorTypeLabel(actorType: string): string {
    return actorTypeLabel(actorType);
  }

  /**
   * Badge fijo del actor type — estilo sólido, distinto de los chips de rol (bordeados y de color por
   * hash), para que el nivel de acceso no se confunda con los roles asignables.
   */
  actorTypeBadge(actorType: string): string {
    switch (actorType) {
      case 'TenantAdmin':
        return 'bg-brand-bold text-white';
      case 'CustomerPortal':
        return 'bg-sky-100 text-sky-700';
      case 'PlatformAdmin':
        return 'bg-brand-ink text-white';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  statusLabel(status: MemberStatus): string {
    switch (status) {
      case 'active':
        return 'Active';
      case 'invited':
        return 'Invited';
      case 'suspended':
        return 'Suspended';
      case 'removed':
        return 'Removed';
      default:
        return status;
    }
  }

  /** Tono de la píldora de estado (`soft`). Removed es terminal: gris apagado, no el rojo de suspended. */
  statusTone(status: MemberStatus): StatusTone {
    switch (status) {
      case 'active':
        return 'success';
      case 'suspended':
        return 'danger';
      case 'removed':
        return 'muted';
      case 'invited':
      default:
        return 'neutral';
    }
  }
}
