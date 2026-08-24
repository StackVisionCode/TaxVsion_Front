import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { TeamMember } from '../user-table/user-table.component';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { UserManagementStore } from '../../data-access/user-management.store';
import { RoleSummary, UserActorType } from '../../data-access/user-management.model';

/** Actor types invitables desde este módulo (staff). CustomerPortal se invita desde Clients, no acá. */
type StaffActorType = Extract<UserActorType, 'TenantEmployee' | 'TenantAdmin'>;

/**
 * Overlay de invitación/edición del módulo User Management (mismo patrón que
 * client-form-panel: el panel hace la llamada real vía el store y emite `saved`
 * al terminar). Un único componente cubre ambos modos: si `member` llega con
 * datos precarga el formulario y actúa como edición de roles ("Edit Member" →
 * PUT /auth/users/{id}/roles); si es null arranca vacío ("Invite Member" →
 * POST /auth/invitations). El picker de roles sale de GET /auth/roles y las
 * descripciones se completan con GET /auth/permissions; el pie muestra los
 * asientos/invitaciones del plan (GET /auth/tenants/limits).
 */
@Component({
  selector: 'app-user-invite-panel',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './user-invite-panel.component.html',
})
export class UserInvitePanelComponent implements OnChanges {
  private readonly store = inject(UserManagementStore);

  @Input() isOpen = false;
  @Input() member: TeamMember | null = null;
  @Output() closed = new EventEmitter<void>();
  /** Emite el email del miembro invitado/editado tras un guardado exitoso. */
  @Output() saved = new EventEmitter<string>();

  readonly roleOptions = this.store.roles;
  readonly limits = this.store.limits;

  readonly email = signal('');
  readonly actorType = signal<StaffActorType>('TenantEmployee');
  readonly selectedRoleIds = signal<string[]>([]);

  readonly isRoleOpen = signal(false);
  readonly isSaving = signal(false);
  readonly saveError = signal<string | null>(null);

  /** Signal propia porque `member` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isEditMode = signal(false);

  readonly canSave = computed(() => {
    if (this.isSaving()) {
      return false;
    }
    if (this.isEditMode()) {
      // PUT roles reemplaza el set completo: exigimos al menos un rol para no dejar al usuario sin ninguno.
      return this.selectedRoleIds().length > 0;
    }
    return /\S+@\S+\.\S+/.test(this.email().trim());
  });

  readonly selectedRolesLabel = computed(() => {
    const selected = this.selectedRoleIds();
    if (selected.length === 0) {
      return this.isEditMode() ? 'Select roles' : 'Assign roles (optional)';
    }
    return this.roleOptions()
      .filter(role => selected.includes(role.id))
      .map(role => role.name)
      .join(', ');
  });

  /** code -> module, para describir roles sin description a partir de sus permisos. */
  private readonly moduleByCode = computed(() => {
    const map = new Map<string, string>();
    for (const permission of this.store.permissions()) {
      map.set(permission.code, permission.module);
    }
    return map;
  });

  /** "Active seats 3/5 · 1 pending invite" — solo informativo, el backend es quien rechaza sin cupo. */
  readonly seatsHint = computed(() => {
    const limits = this.limits();
    if (!limits || this.isEditMode()) {
      return null;
    }
    const seats =
      limits.maxUsers !== null ? `${limits.activeUsers}/${limits.maxUsers} seats in use` : `${limits.activeUsers} active members`;
    const invites = `${limits.pendingInvitations} pending invite${limits.pendingInvitations === 1 ? '' : 's'}`;
    return `${seats} · ${invites}`;
  });

  readonly seatsExhausted = computed(() => {
    const limits = this.limits();
    return !this.isEditMode() && limits !== null && limits.availableSeats === 0;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['member'] || changes['isOpen']) {
      this.isEditMode.set(this.member !== null);
      this.resetForm();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="member-role"]')) {
      this.isRoleOpen.set(false);
    }
  }

  toggleRoleDropdown(): void {
    this.isRoleOpen.update(open => !open);
  }

  toggleRole(roleId: string): void {
    this.selectedRoleIds.update(selected =>
      selected.includes(roleId) ? selected.filter(id => id !== roleId) : [...selected, roleId],
    );
  }

  isRoleSelected(roleId: string): boolean {
    return this.selectedRoleIds().includes(roleId);
  }

  setActorType(actorType: StaffActorType): void {
    this.actorType.set(actorType);
  }

  /** Descripción del rol: la propia, o los módulos que cubren sus permisos, o el conteo de permisos. */
  roleDescription(role: RoleSummary): string {
    if (role.description?.trim()) {
      return role.description;
    }
    const moduleByCode = this.moduleByCode();
    const modules = [...new Set(role.permissionCodes.map(code => moduleByCode.get(code)).filter(Boolean))] as string[];
    if (modules.length > 0) {
      const shown = modules.slice(0, 3).join(', ');
      return modules.length > 3 ? `${shown} +${modules.length - 3} more` : shown;
    }
    return `${role.permissionCodes.length} permission${role.permissionCodes.length === 1 ? '' : 's'}`;
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    this.saveError.set(null);
    this.isSaving.set(true);

    const member = this.member;
    if (this.isEditMode() && member) {
      const roleIds = this.selectedRoleIds();
      const roleNames = this.roleOptions()
        .filter(role => roleIds.includes(role.id))
        .map(role => role.name);
      this.store.assignRoles(member.id, roleIds, roleNames).subscribe({
        next: () => {
          this.isSaving.set(false);
          this.saved.emit(member.email);
        },
        error: err => {
          this.isSaving.set(false);
          this.saveError.set(toApiError(err).message);
        },
      });
      return;
    }

    const email = this.email().trim();
    this.store.invite(email, this.actorType(), this.selectedRoleIds()).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.saved.emit(email);
      },
      error: err => {
        this.isSaving.set(false);
        this.saveError.set(toApiError(err).message);
      },
    });
  }

  private resetForm(): void {
    const member = this.member;
    if (member) {
      this.email.set(member.email);
      this.actorType.set(member.actorType === 'TenantAdmin' ? 'TenantAdmin' : 'TenantEmployee');
      // El backend devuelve nombres de rol en el listado de users: se mapean a ids contra GET /auth/roles.
      const names = member.roleNames.map(name => name.toLowerCase());
      this.selectedRoleIds.set(
        this.roleOptions()
          .filter(role => names.includes(role.name.toLowerCase()))
          .map(role => role.id),
      );
    } else {
      this.email.set('');
      this.actorType.set('TenantEmployee');
      this.selectedRoleIds.set([]);
    }
    this.isRoleOpen.set(false);
    this.isSaving.set(false);
    this.saveError.set(null);
  }
}
