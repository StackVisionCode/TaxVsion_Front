import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';
import { UserManagementService } from '../../../user-management/data-access/user-management.service';
import {
  UserSummary,
  deriveInitials,
  pickAvatarColor,
} from '../../../user-management/data-access/user-management.model';
import { WorkflowStore } from '../../data-access/workflow.store';
import { WorkflowCollaborator, WorkflowCollaboratorRole } from '../../data-access/workflow.model';

const ROLES: WorkflowCollaboratorRole[] = ['owner', 'editor', 'viewer'];

/**
 * Modal de Share: quién está en el workflow y con qué permiso.
 *
 * Es "smart" (por eso vive en `components/`): lee y muta el documento vía
 * `WorkflowStore`, trae los usuarios reales del tenant con
 * `UserManagementService` y conoce al usuario actual por `AuthService`.
 *
 * El dueño es IMPLÍCITO mientras nadie más esté en la lista: se muestra al
 * usuario actual como Owner sin escribirlo en el documento (persistirlo al
 * cargar contaminaría el historial: un undo "borraría al Owner"). Se
 * materializa en el primer añadido real.
 */
@Component({
  selector: 'app-workflow-share-modal',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './workflow-share-modal.component.html',
  styleUrl: './workflow-share-modal.component.css',
})
export class WorkflowShareModalComponent {
  readonly store = inject(WorkflowStore);
  private readonly users = inject(UserManagementService);
  private readonly auth = inject(AuthService);

  private opened = false;

  @Input() set isOpen(value: boolean) {
    this.open.set(value);
    if (value && !this.opened) {
      this.opened = true;
      this.loadUsers();
    }
    if (value) {
      this.error.set(null);
      this.search.set('');
    }
  }

  readonly open = signal(false);
  readonly roles = ROLES;

  readonly tenantUsers = signal<UserSummary[]>([]);
  readonly usersLoading = signal(false);
  readonly usersError = signal<string | null>(null);
  readonly search = signal('');
  /** Motivo del último rechazo (guardas del store: último Owner). */
  readonly error = signal<string | null>(null);

  /** El usuario actual como Owner mientras el documento no tenga a nadie. */
  readonly implicitOwner = computed<WorkflowCollaborator | null>(() => {
    if (this.store.collaborators().length > 0) {
      return null;
    }
    const me = this.auth.currentUser();
    return me
      ? { userId: me.id, name: `${me.name} ${me.lastName}`.trim(), email: me.email, role: 'owner' }
      : null;
  });

  /** Usuarios del tenant que aún no están en el workflow, filtrados. */
  readonly candidates = computed<UserSummary[]>(() => {
    const added = new Set(this.store.collaborators().map(c => c.userId));
    const me = this.auth.currentUser()?.id;
    const query = this.search().trim().toLowerCase();
    return this.tenantUsers().filter(user => {
      if (added.has(user.id) || user.id === me) {
        return false;
      }
      const label = `${user.name} ${user.lastName} ${user.email}`.toLowerCase();
      return !query || label.includes(query);
    });
  });

  private loadUsers(): void {
    this.usersLoading.set(true);
    this.usersError.set(null);
    this.users.getUsers({ page: 1, size: 50, isActive: true }).subscribe({
      next: result => {
        this.tenantUsers.set(result.items ?? []);
        this.usersLoading.set(false);
      },
      error: err => {
        this.usersError.set(toApiError(err).message);
        this.usersLoading.set(false);
      },
    });
  }

  retryUsers(): void {
    this.loadUsers();
  }

  add(user: UserSummary): void {
    this.error.set(null);
    // Con la lista vacía, primero se materializa al dueño implícito: si no, el
    // primer añadido dejaría un workflow con un Editor y ningún Owner.
    const implicit = this.implicitOwner();
    if (implicit) {
      this.store.addCollaborator(implicit);
    }
    this.store.addCollaborator({
      userId: user.id,
      name: `${user.name} ${user.lastName}`.trim(),
      email: user.email,
      role: 'viewer',
    });
  }

  remove(userId: string): void {
    this.error.set(this.store.removeCollaborator(userId));
  }

  setRole(userId: string, role: string): void {
    this.error.set(this.store.setCollaboratorRole(userId, role as WorkflowCollaboratorRole));
  }

  /** El último Owner no muestra botón de quitar: la guarda, reflejada en la UI. */
  isLastOwner(collaborator: WorkflowCollaborator): boolean {
    return (
      collaborator.role === 'owner' &&
      this.store.collaborators().filter(c => c.role === 'owner').length === 1
    );
  }

  initials(name: string): string {
    return deriveInitials(name);
  }

  color(seed: string): string {
    return pickAvatarColor(seed);
  }

  @Output() closed = new EventEmitter<void>();

  onClosed(): void {
    this.open.set(false);
    this.closed.emit();
  }
}
