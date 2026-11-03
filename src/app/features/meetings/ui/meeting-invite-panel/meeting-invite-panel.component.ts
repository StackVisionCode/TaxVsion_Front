import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DrawerComponent } from '@shared/ui/drawer/drawer.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { AvatarUrlPipe } from '@core/profile-photo/avatar-url.pipe';
import { StatusPillComponent, StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { ClickOutsideDirective } from '@shared/directives/click-outside.directive';
import { ClipboardService } from '@shared/services/clipboard.service';
import { toApiError } from '@core/models/api-error.model';
import { InviteeSearchResult, MeetingsStore } from '../../data-access/meetings.store';
import {
  CreatedMeetingInvitation,
  MeetingGuestAccess,
  MeetingInvitationListItem,
  MeetingInviteeDraft,
  recognizedInviteesNotice,
  skippedInviteesNotice,
} from '../../data-access/meeting.model';
import { MeetingGuestAccessComponent } from '../meeting-guest-access/meeting-guest-access.component';
import {
  InvitationState,
  canRevokeInvitation,
  invitationLabel,
  invitationState,
  invitationStateLabel,
  invitationTone,
} from '../../utils/invitation-state';

const INVITEE_SEARCH_DEBOUNCE_MS = 250;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COPIED_FEEDBACK_MS = 2000;

/** Copy por `code` del backend al crear (el resto cae al `message` del error). */
const CREATE_ERROR_COPY: Record<string, string> = {
  'Meeting.NotJoinable': 'This meeting has ended. Invitations can no longer be sent.',
  'Meeting.HostOnly': 'Only the host or a co-host can invite people.',
};

/**
 * F6 — Panel "Invite" de la sala (drawer): invita a gente a la reunión EN CURSO (host/cohost).
 *  - Picker reutilizado del panel de agendar (`MeetingsStore.searchInvitees`: equipo + clientes) y
 *    externos por email con nombre opcional.
 *  - "Send": `POST /meetings/{id}/invitations`; los `joinUrl` solo existen en esa respuesta, así que
 *    "Copy link" se ofrece sobre los recién emitidos (una vez). "Copy code" copia el `shortCode`.
 *  - D-68/D-69: "Allow external guests" y el enlace de la reunión (`app-meeting-guest-access`); con
 *    externos apagados no se agregan por email. MNT-01: quien ya estaba invitado se avisa y no se reenvía.
 *  - Lista `GET /meetings/{id}/invitations` con estado `active|used|revoked|expired|closed`
 *    (utils/invitation-state) y "Revoke" (`DELETE`; si el guest está dentro, lo expulsa).
 *
 *   <app-meeting-invite-panel [isOpen]="inviteOpen()" [meetingId]="activeMeetingId()" [shortCode]="code"
 *     (closed)="inviteOpen.set(false)" />
 *
 * Igual que el panel de agendar, habla con `MeetingsStore` directo: no afecta al listado.
 */
@Component({
  selector: 'app-meeting-invite-panel',
  imports: [
    FormsModule,
    DrawerComponent,
    AvatarComponent,
    AvatarUrlPipe,
    StatusPillComponent,
    InfinityLoaderComponent,
    ClickOutsideDirective,
    MeetingGuestAccessComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-invite-panel.component.html',
})
export class MeetingInvitePanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() meetingId: string | null = null;
  /** Código corto de la reunión ("Copy code"); null = no se conoce (se oculta el botón). */
  @Input() shortCode: string | null = null;
  @Output() closed = new EventEmitter<void>();

  private readonly store = inject(MeetingsStore);
  private readonly clipboard = inject(ClipboardService);

  // ---------- Picker ----------
  readonly inviteeSearch = signal('');
  readonly inviteeResults = signal<InviteeSearchResult>({ employees: [], customers: [] });
  readonly isInviteeOpen = signal(false);
  readonly invitees = signal<MeetingInviteeDraft[]>([]);
  /** Nombre del externo (opcional): aparece en el correo y como nombre sugerido al entrar. */
  readonly externalName = signal('');
  private inviteeDebounce: ReturnType<typeof setTimeout> | null = null;

  // ---------- Invitaciones ----------
  readonly invitations = signal<MeetingInvitationListItem[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly revokingId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  /** Links recién emitidos: única vez que se ven. */
  readonly newLinks = signal<CreatedMeetingInvitation[]>([]);
  readonly copiedKey = signal<string | null>(null);
  /** MNT-01: aviso tras enviar (ya invitados / reconocidos como equipo o cliente). */
  readonly notice = signal<string | null>(null);
  /** D-69: acceso de externos de la reunión; null hasta cargarlo (no se bloquea mientras tanto). */
  readonly guestAccess = signal<MeetingGuestAccess | null>(null);
  readonly externalsAllowed = computed(() => this.guestAccess()?.guestsAllowed ?? true);

  readonly externalCandidate = computed<string | null>(() => {
    const raw = this.inviteeSearch().trim();
    return EMAIL_PATTERN.test(raw) ? raw.toLowerCase() : null;
  });
  readonly canSend = computed(() => this.invitees().length > 0 && !this.busy() && !!this.meetingId);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] || changes['meetingId']) {
      this.reset();
      if (this.isOpen && this.meetingId) {
        this.loadInvitations();
      }
    }
  }

  // ---------- Picker ----------

  onInviteeSearchChange(term: string): void {
    this.inviteeSearch.set(term);
    if (this.inviteeDebounce !== null) {
      clearTimeout(this.inviteeDebounce);
    }
    const query = term.trim();
    if (!query) {
      this.inviteeResults.set({ employees: [], customers: [] });
      this.isInviteeOpen.set(false);
      return;
    }
    this.isInviteeOpen.set(true);
    this.inviteeDebounce = setTimeout(() => {
      this.inviteeDebounce = null;
      this.store.searchInvitees(query).subscribe({
        next: results => this.inviteeResults.set(results),
        error: () => this.inviteeResults.set({ employees: [], customers: [] }),
      });
    }, INVITEE_SEARCH_DEBOUNCE_MS);
  }

  addEmployee(entry: { userId: string; displayName: string; email: string; avatarFileId?: string | null }): void {
    this.addInvitee({ kind: 'employee', userId: entry.userId, email: entry.email || null, name: entry.displayName, avatarFileId: entry.avatarFileId ?? null });
  }

  addCustomer(entry: { customerId: string; displayName: string; email: string; avatarFileId?: string | null }): void {
    this.addInvitee({ kind: 'customer', userId: null, customerId: entry.customerId, email: entry.email, name: entry.displayName, avatarFileId: entry.avatarFileId ?? null });
  }

  addExternal(): void {
    const email = this.externalCandidate();
    if (email && this.externalsAllowed()) {
      const name = this.externalName().trim() || email.split('@')[0];
      this.addInvitee({ kind: 'external', userId: null, email, name });
      this.externalName.set('');
    }
  }

  private addInvitee(draft: MeetingInviteeDraft): void {
    // El email solo deduplica externos: un empleado y un cliente pueden compartir correo (cuentas staff + portal).
    const duplicated = this.invitees().some(
      existing =>
        (draft.userId && existing.userId === draft.userId) ||
        (draft.customerId && existing.customerId === draft.customerId) ||
        (draft.kind === 'external' && existing.kind === 'external' && !!draft.email && existing.email === draft.email),
    );
    if (!duplicated) {
      this.invitees.update(list => [...list, draft]);
    }
    this.inviteeSearch.set('');
    this.inviteeResults.set({ employees: [], customers: [] });
    this.isInviteeOpen.set(false);
  }

  /** Con externos apagados, los externos elegidos y no enviados ya no pueden entrar: fuera de la lista. */
  onGuestAccessChange(access: MeetingGuestAccess): void {
    this.guestAccess.set(access);
    if (!access.guestsAllowed) {
      this.invitees.update(list => list.filter(invitee => invitee.kind !== 'external'));
    }
  }

  removeInvitee(index: number): void {
    this.invitees.update(list => list.filter((_, i) => i !== index));
  }

  kindLabel(kind: MeetingInviteeDraft['kind']): string {
    switch (kind) {
      case 'employee':
        return 'Team';
      case 'customer':
        return 'Client';
      case 'external':
        return 'External';
    }
  }

  // ---------- Enviar / listar / revocar ----------

  send(): void {
    const meetingId = this.meetingId;
    const drafts = this.invitees();
    if (!meetingId || drafts.length === 0 || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.store.createInvitations(meetingId, drafts).subscribe({
      next: ({ invitations: created, skipped }) => {
        const notices = [skippedInviteesNotice(skipped), recognizedInviteesNotice(drafts, created)].filter(Boolean);
        this.notice.set(notices.length ? notices.join(' ') : null);
        this.newLinks.update(list => [...created, ...list]);
        this.invitees.set([]);
        this.busy.set(false);
        this.loadInvitations();
      },
      error: err => {
        const apiError = toApiError(err);
        this.error.set(CREATE_ERROR_COPY[apiError.code] ?? apiError.message);
        this.busy.set(false);
      },
    });
  }

  loadInvitations(): void {
    const meetingId = this.meetingId;
    if (!meetingId) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.store.listInvitations(meetingId).subscribe({
      next: items => {
        this.invitations.set([...items]);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(toApiError(err).message);
        this.loading.set(false);
      },
    });
  }

  revoke(invitation: MeetingInvitationListItem): void {
    const meetingId = this.meetingId;
    if (!meetingId || this.revokingId()) {
      return;
    }
    this.revokingId.set(invitation.id);
    this.error.set(null);
    this.store.revokeInvitation(meetingId, invitation.id).subscribe({
      next: () => {
        this.revokingId.set(null);
        // El link recién emitido de esa invitación ya no sirve: fuera de la lista de "copiar".
        this.newLinks.update(list => list.filter(link => link.id !== invitation.id));
        this.loadInvitations();
      },
      error: err => {
        this.error.set(toApiError(err).message);
        this.revokingId.set(null);
      },
    });
  }

  // ---------- Estado por fila (utils compartidas con el panel de agendar) ----------

  stateOf(invitation: MeetingInvitationListItem): InvitationState {
    return invitationState(invitation);
  }
  toneOf(invitation: MeetingInvitationListItem): StatusTone {
    return invitationTone(invitationState(invitation));
  }
  stateLabelOf(invitation: MeetingInvitationListItem): string {
    return invitationStateLabel(invitationState(invitation));
  }
  canRevoke(invitation: MeetingInvitationListItem): boolean {
    return canRevokeInvitation(invitationState(invitation));
  }
  labelOf(invitation: MeetingInvitationListItem): string {
    return invitationLabel(invitation);
  }
  /** "Joined ×3" para usuarios con cuenta (token reutilizable); null si no aporta. */
  useHint(invitation: MeetingInvitationListItem): string | null {
    const count = invitation.useCount ?? 0;
    return invitation.inviteeKind !== 'External' && count > 0 ? `Joined ×${count}` : null;
  }

  // ---------- Copiar ----------

  copyCode(): void {
    if (this.shortCode) {
      this.copy('code', this.shortCode);
    }
  }

  copyLink(link: CreatedMeetingInvitation): void {
    this.copy(link.id, link.joinUrl);
  }

  private copy(key: string, text: string): void {
    void this.clipboard.copy(text).then(copied => {
      if (!copied) {
        return;
      }
      this.copiedKey.set(key);
      setTimeout(() => {
        if (this.copiedKey() === key) {
          this.copiedKey.set(null);
        }
      }, COPIED_FEEDBACK_MS);
    });
  }

  close(): void {
    this.closed.emit();
  }

  private reset(): void {
    this.invitees.set([]);
    this.inviteeSearch.set('');
    this.externalName.set('');
    this.inviteeResults.set({ employees: [], customers: [] });
    this.isInviteeOpen.set(false);
    this.invitations.set([]);
    this.newLinks.set([]);
    this.error.set(null);
    this.copiedKey.set(null);
    this.notice.set(null);
    this.busy.set(false);
    this.revokingId.set(null);
  }
}
