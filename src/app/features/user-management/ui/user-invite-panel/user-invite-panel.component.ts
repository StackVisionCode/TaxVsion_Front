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
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MemberRole, ROLE_OPTIONS, RoleOption, TeamMember } from '../user-table/user-table.component';

const AVATAR_PALETTE = ['bg-indigo-500', 'bg-[#7C6AE0]', 'bg-orange-500', 'bg-green-500'];

/** Turns "sofia.martinez@taxvision.com" into "Sofia Martinez" for freshly-invited members. */
function deriveNameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const words = localPart.split(/[._\-+0-9]+/).filter(Boolean);
  if (words.length === 0) {
    return 'New member';
  }
  return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
  }
  return (words[0] ?? 'NM').slice(0, 2).toUpperCase();
}

function pickAvatarColor(seed: string): string {
  const hash = seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

/**
 * Overlay de invitación/edición del módulo User Management (mismo patrón
 * que task-create-panel): tarjeta centrada `rounded-[28px]` sobre backdrop
 * con stopPropagation. Un único componente cubre ambos modos: si `member`
 * llega con datos precarga el formulario y actúa como edición de rol
 * ("Edit Member" / "Save changes"); si es null arranca vacío ("Invite
 * Member" / "Send invite"). Las invitaciones nuevas quedan con status
 * 'invited'; las ediciones conservan el status existente.
 */
@Component({
  selector: 'app-user-invite-panel',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './user-invite-panel.component.html',
})
export class UserInvitePanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() member: TeamMember | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<TeamMember>();

  readonly roleOptions: RoleOption[] = ROLE_OPTIONS;

  readonly email = signal('');
  readonly role = signal<MemberRole>('preparer');

  readonly isRoleOpen = signal(false);

  /** Signal propia porque `member` es un @Input plano: un computed() no reaccionaría a sus cambios. */
  readonly isEditMode = signal(false);

  readonly canSave = computed(() => /\S+@\S+\.\S+/.test(this.email().trim()));

  readonly selectedRole = computed<RoleOption>(
    () => this.roleOptions.find(option => option.id === this.role()) ?? this.roleOptions[2],
  );

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

  selectRole(role: MemberRole): void {
    this.role.set(role);
    this.isRoleOpen.set(false);
  }

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }
    const existing = this.member;
    const email = this.email().trim();
    const name = existing?.name ?? deriveNameFromEmail(email);
    const result: TeamMember = {
      id: existing?.id ?? `member-${Date.now()}`,
      name,
      initials: existing?.initials ?? deriveInitials(name),
      avatarColor: existing?.avatarColor ?? pickAvatarColor(email),
      email,
      role: this.role(),
      status: existing?.status ?? 'invited',
      lastActive: existing?.lastActive ?? 'Invited just now',
    };
    this.saved.emit(result);
  }

  private resetForm(): void {
    const member = this.member;
    if (member) {
      this.email.set(member.email);
      this.role.set(member.role);
    } else {
      this.email.set('');
      this.role.set('preparer');
    }
    this.isRoleOpen.set(false);
  }
}
