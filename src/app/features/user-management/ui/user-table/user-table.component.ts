import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export type MemberStatus = 'active' | 'invited' | 'suspended';

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
 * se recorta roles a sí mismo desde acá. El menú abierto se rastrea con una
 * signal y se cierra al hacer click fuera de la fila correspondiente.
 */
@Component({
  selector: 'app-user-table',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './user-table.component.html',
})
export class UserTableComponent {
  @Input() members: TeamMember[] = [];
  @Input() currentUserId: string | null = null;
  @Input() emptyMessage = 'No team members found';
  @Output() editRoles = new EventEmitter<TeamMember>();
  @Output() resendInvite = new EventEmitter<TeamMember>();
  @Output() toggleSuspend = new EventEmitter<TeamMember>();
  @Output() cancelInvite = new EventEmitter<TeamMember>();

  readonly openMenuId = signal<string | null>(null);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const openId = this.openMenuId();
    if (!openId) {
      return;
    }
    const target = event.target as HTMLElement;
    if (!target.closest(`[data-dropdown="member-menu-${openId}"]`)) {
      this.openMenuId.set(null);
    }
  }

  toggleMenu(member: TeamMember): void {
    this.openMenuId.update(current => (current === member.id ? null : member.id));
  }

  closeMenu(): void {
    this.openMenuId.set(null);
  }

  /** Chip determinístico por nombre de rol (los roles del tenant son dinámicos, no un enum fijo). */
  roleChip(roleName: string): string {
    const hash = roleName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return ROLE_CHIP_PALETTE[hash % ROLE_CHIP_PALETTE.length];
  }

  statusLabel(status: MemberStatus): string {
    switch (status) {
      case 'active':
        return 'Active';
      case 'invited':
        return 'Invited';
      case 'suspended':
        return 'Suspended';
      default:
        return status;
    }
  }

  statusChip(status: MemberStatus): string {
    switch (status) {
      case 'active':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700';
      case 'invited':
        return 'border-gray-200 bg-gray-100 text-gray-600';
      case 'suspended':
        return 'border-red-200 bg-red-50 text-red-700';
      default:
        return 'border-gray-200 bg-gray-50 text-gray-600';
    }
  }

  statusDotClass(status: MemberStatus): string {
    switch (status) {
      case 'active':
        return 'bg-emerald-500';
      case 'invited':
        return 'bg-gray-400';
      case 'suspended':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  }
}
