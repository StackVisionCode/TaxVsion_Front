import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export type MemberRole = 'owner' | 'admin' | 'preparer' | 'viewer';
export type MemberStatus = 'active' | 'invited' | 'suspended';

export interface TeamMember {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  lastActive: string;
}

export interface RoleOption {
  id: MemberRole;
  label: string;
  description: string;
}

/** Shared role catalog: used by the table badges and the invite/edit panel's dropdown. */
export const ROLE_OPTIONS: RoleOption[] = [
  { id: 'owner', label: 'Owner', description: 'Full control over billing, staff and firm-wide settings.' },
  { id: 'admin', label: 'Admin', description: 'Manage staff, clients and workflows across the firm.' },
  { id: 'preparer', label: 'Preparer', description: 'Prepare and file returns for assigned clients.' },
  { id: 'viewer', label: 'Viewer', description: 'Read-only access to clients, documents and reports.' },
];

/**
 * Tabla de miembros del equipo (patrón "pill header" de service-catalog):
 * cabecera con fondo suave y filas redondeadas. Cada fila (salvo la del
 * Owner, que no se puede editar ni eliminar) tiene un menú "..." con
 * Edit role / Resend invite (solo si está invitado) / Suspend-Reactivate /
 * Remove. El menú abierto se rastrea con una signal y se cierra al hacer
 * click fuera de la fila correspondiente.
 */
@Component({
  selector: 'app-user-table',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './user-table.component.html',
})
export class UserTableComponent {
  @Input() members: TeamMember[] = [];
  @Output() editRole = new EventEmitter<TeamMember>();
  @Output() resendInvite = new EventEmitter<TeamMember>();
  @Output() toggleSuspend = new EventEmitter<TeamMember>();
  @Output() remove = new EventEmitter<TeamMember>();

  readonly roles = ROLE_OPTIONS;
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

  roleLabel(role: MemberRole): string {
    return this.roles.find(option => option.id === role)?.label ?? role;
  }

  roleChip(role: MemberRole): string {
    switch (role) {
      case 'owner':
        return 'border-indigo-200 bg-indigo-50 text-indigo-700';
      case 'admin':
        return 'border-[#7C6AE0]/30 bg-[#EEEBFA] text-[#7C6AE0]';
      case 'preparer':
        return 'border-orange-200 bg-orange-50 text-orange-700';
      case 'viewer':
      default:
        return 'border-gray-200 bg-gray-50 text-gray-600';
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
