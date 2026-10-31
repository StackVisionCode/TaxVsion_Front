import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, SimpleChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { AvatarUrlPipe } from '@core/profile-photo/avatar-url.pipe';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { SegmentedComponent, SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { AuthService } from '@core/auth/auth.service';
import { ChatStore } from '../../data-access/chat.store';
import { ChatService } from '../../data-access/chat.service';
import { ChatGroupAdminService } from '../../data-access/chat-group-admin.service';
import { MemberActions, isClientActor, isGroupAdmin, memberActions } from '../../data-access/chat-groups';
import type { ChatParticipant, GroupActivityItem } from '../../data-access/chat.model';
import type { ChatConversation } from '../chat-conversation-list/chat-conversation-list.component';

const SEARCH_DEBOUNCE_MS = 300;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 500;

type AddAudience = 'team' | 'clients';

/**
 * F8b: "Info" de un grupo (ADD-05 §13): datos (nombre, descripción, foto), miembros con su rol y las acciones que
 * mi rol permite, modo anuncio, silencio propio, bitácora y salir. El backend valida todo (D-22); aquí solo se
 * ofrece lo que tiene sentido para mi rol. El estado llega por los eventos en vivo, no por respuestas locales.
 */
@Component({
  selector: 'app-group-info-panel',
  imports: [CommonModule, FormsModule, AvatarComponent, AvatarUrlPipe, SwitchComponent, SearchInputComponent, SegmentedComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './group-info-panel.component.html',
})
export class GroupInfoPanelComponent implements OnChanges {
  protected readonly store = inject(ChatStore);
  protected readonly admin = inject(ChatGroupAdminService);
  private readonly chat = inject(ChatService);
  private readonly auth = inject(AuthService);

  @Input({ required: true }) conversation!: ChatConversation;

  readonly titleMax = TITLE_MAX;
  readonly descriptionMax = DESCRIPTION_MAX;
  readonly currentUserId = computed(() => this.auth.currentUser()?.id ?? null);

  readonly editing = signal(false);
  readonly draftTitle = signal('');
  readonly draftDescription = signal('');
  readonly expandedMemberId = signal<string | null>(null);
  readonly confirmLeave = signal(false);

  readonly adding = signal(false);
  readonly addAudience = signal<AddAudience>('team');
  readonly addAudienceOptions: SegmentedOption<AddAudience>[] = [
    { id: 'team', label: 'Team' },
    { id: 'clients', label: 'Clients' },
  ];
  readonly addSearch = signal('');
  private searchDebounce: ReturnType<typeof setTimeout> | undefined;

  readonly activity = signal<GroupActivityItem[] | null>(null);
  readonly activityLoading = signal(false);
  readonly activityError = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    const previous = changes['conversation']?.previousValue as ChatConversation | undefined;
    if (previous?.id !== this.conversation?.id) {
      this.editing.set(false);
      this.adding.set(false);
      this.confirmLeave.set(false);
      this.expandedMemberId.set(null);
      this.activity.set(null);
    }
  }

  get members(): ChatParticipant[] {
    const order = { Owner: 0, Admin: 1, Member: 2 } as const;
    return [...(this.conversation.participants ?? [])].sort(
      (a, b) => order[a.role ?? 'Member'] - order[b.role ?? 'Member'] || a.displayName.localeCompare(b.displayName),
    );
  }

  get canManage(): boolean {
    return !this.conversation.isArchived && (isGroupAdmin(this.conversation.myRole) || this.store.canAdministerAnyGroup());
  }

  get isMember(): boolean {
    return !!this.conversation.myRole;
  }

  actionsFor(member: ChatParticipant): MemberActions {
    if (this.conversation.isArchived) {
      return { makeAdmin: false, removeAdmin: false, makeOwner: false, remove: false };
    }
    return memberActions(
      { userId: this.currentUserId(), role: this.conversation.myRole, superpower: this.store.canAdministerAnyGroup() },
      member,
    );
  }

  hasActions(member: ChatParticipant): boolean {
    const a = this.actionsFor(member);
    return a.makeAdmin || a.removeAdmin || a.makeOwner || a.remove;
  }

  isClient(member: ChatParticipant): boolean {
    return isClientActor(member.actorType);
  }

  toggleMember(member: ChatParticipant): void {
    if (!this.hasActions(member)) {
      return;
    }
    this.expandedMemberId.update(id => (id === member.userId ? null : member.userId));
  }

  // ---------- datos del grupo ----------
  startEdit(): void {
    this.draftTitle.set(this.conversation.name);
    this.draftDescription.set(this.conversation.description ?? '');
    this.editing.set(true);
  }

  async saveInfo(): Promise<void> {
    const title = this.draftTitle().trim();
    const description = this.draftDescription().trim();
    if (!title) {
      return;
    }
    const changes: { title?: string; description?: string | null } = {};
    if (title !== this.conversation.name) {
      changes.title = title;
    }
    if (description !== (this.conversation.description ?? '')) {
      changes.description = description || null;
    }
    if (Object.keys(changes).length === 0 || (await this.admin.updateInfo(this.conversation.id, changes))) {
      this.editing.set(false);
    }
  }

  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      await this.admin.uploadPhoto(this.conversation.id, file);
    }
  }

  removePhoto(): void {
    void this.admin.updateInfo(this.conversation.id, { avatarFileId: null });
  }

  // ---------- miembros ----------
  makeAdmin(member: ChatParticipant): void {
    void this.admin.setRole(this.conversation.id, member.userId, 'Admin');
  }

  removeAdmin(member: ChatParticipant): void {
    void this.admin.setRole(this.conversation.id, member.userId, 'Member');
  }

  makeOwner(member: ChatParticipant): void {
    void this.admin.makeOwner(this.conversation.id, member.userId);
  }

  removeMember(member: ChatParticipant): void {
    void this.admin.removeMember(this.conversation.id, member.userId);
  }

  async leave(): Promise<void> {
    if (!this.confirmLeave()) {
      this.confirmLeave.set(true);
      return;
    }
    await this.admin.leave(this.conversation.id);
  }

  setAdminsOnly(enabled: boolean): void {
    void this.admin.setAdminsOnly(this.conversation.id, enabled);
  }

  setMuted(muted: boolean): void {
    void this.admin.setMuted(this.conversation.id, muted);
  }

  // ---------- agregar ----------
  openAdd(): void {
    this.adding.set(true);
    this.addSearch.set('');
    this.store.resetNewConversationState();
  }

  setAddAudience(audience: AddAudience): void {
    this.addAudience.set(audience);
    this.onAddSearch(this.addSearch());
  }

  onAddSearch(term: string): void {
    this.addSearch.set(term);
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      if (this.addAudience() === 'clients') {
        this.store.searchCustomers(term);
      } else {
        this.store.searchEmployees(term);
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  /** Candidatos que todavía no están en el grupo (los clientes sin portal no se pueden agregar). */
  get candidates(): { userId: string; displayName: string; email: string; avatarFileId?: string | null }[] {
    const inGroup = new Set((this.conversation.participants ?? []).map(p => p.userId));
    if (this.addAudience() === 'clients') {
      return this.store
        .customerResults()
        .filter(c => !!c.portalUserId && !inGroup.has(c.portalUserId))
        .map(c => ({ userId: c.portalUserId as string, displayName: c.displayName, email: c.email, avatarFileId: c.avatarFileId }));
    }
    return this.store.employeeResults().filter(e => !inGroup.has(e.userId));
  }

  async add(userId: string): Promise<void> {
    if (await this.admin.addMember(this.conversation.id, userId)) {
      this.adding.set(false);
    }
  }

  // ---------- bitácora ----------
  loadActivity(): void {
    this.activityLoading.set(true);
    this.activityError.set(false);
    this.chat.getGroupActivity(this.conversation.id).subscribe({
      next: page => {
        this.activity.set(page.items);
        this.activityLoading.set(false);
      },
      error: () => {
        this.activityError.set(true);
        this.activityLoading.set(false);
      },
    });
  }

  activityText(item: GroupActivityItem): string {
    // El servidor manda el nombre aunque ya no sea miembro (E2E F8); la lista local queda de respaldo.
    const name = (id: string | null, known: string | null | undefined) =>
      id ? (known ?? (this.conversation.participants ?? []).find(p => p.userId === id)?.displayName ?? 'A former member') : 'The system';
    const actor = name(item.actorUserId, item.actorDisplayName);
    const target = name(item.targetUserId, item.targetDisplayName);
    switch (item.action) {
      case 'GroupCreated':
        return `${actor} created the group`;
      case 'MemberAdded':
        return `${actor} added ${target}`;
      case 'MemberRemoved':
        return item.actorUserId ? `${actor} removed ${target}` : `${target} left the office`;
      case 'MemberLeft':
        return `${target} left`;
      case 'RoleChanged':
        return item.metadata?.['to'] === 'Admin' ? `${actor} made ${target} an admin` : `${actor} removed ${target} as admin`;
      case 'OwnershipTransferred':
        return item.actorUserId ? `${actor} made ${target} the owner` : `${target} became the owner`;
      case 'InfoUpdated':
        return `${actor} updated the group info`;
      case 'AdminsOnlyChanged':
        return item.metadata?.['enabled'] ? `${actor} limited messages to admins` : `${actor} let all members send messages`;
      case 'Archived':
        return 'The group became read-only';
      default:
        return 'Group updated';
    }
  }
}
