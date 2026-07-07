import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TeamMember, UserTableComponent } from '../../ui/user-table/user-table.component';
import { UserInvitePanelComponent } from '../../ui/user-invite-panel/user-invite-panel.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';

const PAGE_SIZE = 8;

const SEED_MEMBERS: TeamMember[] = [
  {
    id: 'member-1',
    name: 'Jordan Reyes',
    initials: 'JR',
    avatarColor: 'bg-indigo-600',
    email: 'jordan.reyes@taxvision.com',
    role: 'owner',
    status: 'active',
    lastActive: 'Just now',
  },
  {
    id: 'member-2',
    name: 'James Cooper',
    initials: 'JC',
    avatarColor: 'bg-indigo-500',
    email: 'james.cooper@taxvision.com',
    role: 'admin',
    status: 'active',
    lastActive: '2 hours ago',
  },
  {
    id: 'member-3',
    name: 'Elena Vargas',
    initials: 'EV',
    avatarColor: 'bg-orange-500',
    email: 'elena.vargas@taxvision.com',
    role: 'preparer',
    status: 'active',
    lastActive: '1 hour ago',
  },
  {
    id: 'member-4',
    name: 'Sarah Mitchell',
    initials: 'SM',
    avatarColor: 'bg-[#7C6AE0]',
    email: 'sarah.mitchell@taxvision.com',
    role: 'admin',
    status: 'active',
    lastActive: '3 hours ago',
  },
  {
    id: 'member-5',
    name: 'Aisha Thompson',
    initials: 'AT',
    avatarColor: 'bg-green-500',
    email: 'aisha.thompson@taxvision.com',
    role: 'preparer',
    status: 'active',
    lastActive: 'Yesterday',
  },
  {
    id: 'member-6',
    name: 'Marcus Webb',
    initials: 'MW',
    avatarColor: 'bg-indigo-500',
    email: 'marcus.webb@taxvision.com',
    role: 'preparer',
    status: 'active',
    lastActive: '5 hours ago',
  },
  {
    id: 'member-7',
    name: 'Priya Natarajan',
    initials: 'PN',
    avatarColor: 'bg-orange-500',
    email: 'priya.natarajan@taxvision.com',
    role: 'viewer',
    status: 'active',
    lastActive: '2 days ago',
  },
  {
    id: 'member-8',
    name: 'David Chen',
    initials: 'DC',
    avatarColor: 'bg-[#7C6AE0]',
    email: 'david.chen@taxvision.com',
    role: 'preparer',
    status: 'invited',
    lastActive: 'Invited 3 days ago',
  },
  {
    id: 'member-9',
    name: 'Robert Kim',
    initials: 'RK',
    avatarColor: 'bg-indigo-500',
    email: 'robert.kim@taxvision.com',
    role: 'admin',
    status: 'suspended',
    lastActive: '3 weeks ago',
  },
];

/**
 * Página del módulo User Management (estilo "Aether"): directorio del
 * equipo/staff de la firma con roles e invitaciones, distinto de Profile
 * (que es la página del usuario logueado). Stats pastel arriba + barra de
 * búsqueda/"Invite member" + tabla de miembros + panel de invitación/
 * edición. Todo el estado vive en signals dentro de esta página, sin
 * servicios ni backend; el único miembro 'owner' no puede editarse ni
 * eliminarse (la tabla oculta su menú de acciones).
 */
@Component({
  selector: 'app-user-management-page',
  imports: [CommonModule, FormsModule, UserTableComponent, UserInvitePanelComponent, PaginationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './user-management-page.component.html',
})
export class UserManagementPageComponent {
  readonly members = signal<TeamMember[]>(SEED_MEMBERS);
  readonly search = signal('');

  readonly isPanelOpen = signal(false);
  readonly editingMember = signal<TeamMember | null>(null);

  readonly toast = signal<string | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  readonly totalCount = computed(() => this.members().length);
  readonly activeCount = computed(() => this.members().filter(member => member.status === 'active').length);
  readonly pendingInvitesCount = computed(() => this.members().filter(member => member.status === 'invited').length);

  readonly filteredMembers = computed<TeamMember[]>(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) {
      return this.members();
    }
    return this.members().filter(
      member => member.name.toLowerCase().includes(query) || member.email.toLowerCase().includes(query),
    );
  });

  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly pagedMembers = computed<TeamMember[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.filteredMembers().slice(start, start + PAGE_SIZE);
  });

  onSearchChange(value: string): void {
    this.search.set(value);
    this.currentPage.set(1);
  }

  openInvitePanel(): void {
    this.editingMember.set(null);
    this.isPanelOpen.set(true);
  }

  openEditPanel(member: TeamMember): void {
    this.editingMember.set(member);
    this.isPanelOpen.set(true);
  }

  closePanel(): void {
    this.isPanelOpen.set(false);
    this.editingMember.set(null);
  }

  handleSaved(member: TeamMember): void {
    this.members.update(list => {
      const exists = list.some(item => item.id === member.id);
      return exists ? list.map(item => (item.id === member.id ? member : item)) : [...list, member];
    });
    this.showToast(this.editingMember() ? 'Member updated' : `Invite sent to ${member.email}`);
    this.closePanel();
  }

  resendInvite(member: TeamMember): void {
    this.showToast(`Invite resent to ${member.email}`);
  }

  toggleSuspend(member: TeamMember): void {
    this.members.update(list =>
      list.map(item =>
        item.id === member.id ? { ...item, status: item.status === 'suspended' ? 'active' : 'suspended' } : item,
      ),
    );
    this.showToast(member.status === 'suspended' ? `${member.name} reactivated` : `${member.name} suspended`);
  }

  removeMember(member: TeamMember): void {
    this.members.update(list => list.filter(item => item.id !== member.id));
    this.showToast(`${member.name} removed`);
  }

  private showToast(message: string): void {
    this.toast.set(message);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 2500);
  }
}
