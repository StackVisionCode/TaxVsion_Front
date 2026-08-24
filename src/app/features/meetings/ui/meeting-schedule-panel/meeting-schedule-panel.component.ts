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
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { toApiError } from '@core/models/api-error.model';
import { InviteeSearchResult, MeetingCreationOutcome, MeetingsStore } from '../../data-access/meetings.store';
import {
  CreatedMeetingInvitation,
  MeetingFormValue,
  MeetingInvitationListItem,
  MeetingInviteeDraft,
  MeetingItem,
  meetingAvatarColorFor,
  meetingInitialsFor,
} from '../../data-access/meeting.model';

const INVITEE_SEARCH_DEBOUNCE_MS = 250;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Estado derivado de una invitación existente (para el chip de la lista). */
type InvitationState = 'active' | 'used' | 'revoked' | 'expired';

/**
 * Overlay de programar/gestionar reunión contra Communication. Un componente,
 * dos modos:
 *  - Crear (`meeting` null): título + descripción + fecha/hora (opcional —
 *    vacío crea un meeting instantáneo) + invitados (type-ahead sobre
 *    /communication/directory + externos por email). El componente emite
 *    `createRequested`; el store orquesta POST /meetings (+ invitations) y la
 *    página inyecta `creationOutcome` para mostrar el paso de links (los
 *    joinUrl solo existen en esa respuesta).
 *  - Gestionar (`meeting` != null, host + Scheduled): SOLO se puede
 *    re-agendar la fecha (el backend no tiene edición de título/descripción)
 *    y administrar invitaciones (listar/revocar/agregar), que este panel
 *    maneja directo contra el store porque no afectan el listado.
 * Campos del mock sin endpoint (cliente, duración): eliminados.
 */
@Component({
  selector: 'app-meeting-schedule-panel',
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './meeting-schedule-panel.component.html',
})
export class MeetingSchedulePanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() meeting: MeetingItem | null = null;
  /** Guardado en curso (create/reschedule): deshabilita acciones. */
  @Input() busy = false;
  /** Error del último intento de crear/re-agendar; se muestra dentro del panel. */
  @Input() errorMessage: string | null = null;
  /** Resultado de la creación: activa el paso de links (shortCode + joinUrls). */
  @Input() creationOutcome: MeetingCreationOutcome | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() createRequested = new EventEmitter<MeetingFormValue>();
  @Output() rescheduleRequested = new EventEmitter<{ meeting: MeetingItem; scheduledForUtc: string | null }>();

  private readonly store = inject(MeetingsStore);

  /** Signal propia porque `meeting` es un @Input plano (mismo criterio que task-create-panel). */
  readonly isEditMode = signal(false);

  // ---------- Formulario ----------
  readonly title = signal('');
  readonly description = signal('');
  readonly date = signal('');
  readonly time = signal('');

  // ---------- Picker de invitados ----------
  readonly inviteeSearch = signal('');
  readonly inviteeResults = signal<InviteeSearchResult>({ employees: [], customers: [] });
  readonly isInviteeOpen = signal(false);
  readonly invitees = signal<MeetingInviteeDraft[]>([]);
  private inviteeDebounce: ReturnType<typeof setTimeout> | null = null;

  // ---------- Invitaciones existentes (solo modo gestionar) ----------
  readonly invitations = signal<MeetingInvitationListItem[]>([]);
  readonly invitationsLoading = signal(false);
  readonly invitationsError = signal<string | null>(null);
  /** Links recién emitidos desde "Send invitations" (única vez que se ven). */
  readonly newInvitationLinks = signal<CreatedMeetingInvitation[]>([]);
  readonly invitationsBusy = signal(false);

  /** Feedback de copiado (key = id de invitación o 'code'). */
  readonly copiedKey = signal<string | null>(null);

  /** El email tipeado sirve como invitado externo (kind external). */
  readonly externalCandidate = computed<string | null>(() => {
    const raw = this.inviteeSearch().trim();
    return EMAIL_PATTERN.test(raw) ? raw.toLowerCase() : null;
  });

  readonly canSave = computed(() => {
    const hasDate = !!this.date();
    const hasTime = !!this.time();
    if (this.isEditMode()) {
      // Re-agendar: fecha y hora completas, o ambas vacías (des-agendar).
      return hasDate === hasTime;
    }
    return this.title().trim().length > 0 && hasDate === hasTime;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['meeting'] || changes['isOpen']) {
      this.isEditMode.set(this.meeting !== null);
      this.resetForm();
      if (this.isOpen && this.meeting?.isHost) {
        this.loadInvitations();
      }
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="meeting-invitee"]')) {
      this.isInviteeOpen.set(false);
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

  addEmployee(entry: { userId: string; displayName: string; email: string }): void {
    this.addInvitee({ kind: 'employee', userId: entry.userId, email: entry.email || null, name: entry.displayName });
  }

  /** Customers van por email: su customerId no es un userId de Auth. */
  addCustomer(entry: { displayName: string; email: string }): void {
    this.addInvitee({ kind: 'customer', userId: null, email: entry.email, name: entry.displayName });
  }

  addExternal(): void {
    const email = this.externalCandidate();
    if (email) {
      this.addInvitee({ kind: 'external', userId: null, email, name: email.split('@')[0] });
    }
  }

  private addInvitee(draft: MeetingInviteeDraft): void {
    const duplicated = this.invitees().some(
      existing =>
        (draft.userId && existing.userId === draft.userId) || (draft.email && existing.email === draft.email),
    );
    if (!duplicated) {
      this.invitees.update(list => [...list, draft]);
    }
    this.inviteeSearch.set('');
    this.inviteeResults.set({ employees: [], customers: [] });
    this.isInviteeOpen.set(false);
  }

  removeInvitee(index: number): void {
    this.invitees.update(list => list.filter((_, i) => i !== index));
  }

  initialsFor(name: string): string {
    return meetingInitialsFor(name);
  }

  colorFor(seed: string): string {
    return meetingAvatarColorFor(seed);
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

  // ---------- Invitaciones existentes (modo gestionar) ----------

  loadInvitations(): void {
    const meeting = this.meeting;
    if (!meeting) {
      return;
    }
    this.invitationsLoading.set(true);
    this.invitationsError.set(null);
    this.store.listInvitations(meeting.id).subscribe({
      next: items => {
        this.invitations.set([...items]);
        this.invitationsLoading.set(false);
      },
      error: err => {
        this.invitationsError.set(toApiError(err).message);
        this.invitationsLoading.set(false);
      },
    });
  }

  invitationState(invitation: MeetingInvitationListItem): InvitationState {
    if (invitation.revokedAt) {
      return 'revoked';
    }
    if (invitation.usedAt) {
      return 'used';
    }
    if (new Date(invitation.expiresAt).getTime() < Date.now()) {
      return 'expired';
    }
    return 'active';
  }

  invitationLabel(invitation: MeetingInvitationListItem): string {
    return invitation.inviteeName || invitation.inviteeEmail || invitation.inviteeUserId || 'Guest';
  }

  revokeInvitation(invitation: MeetingInvitationListItem): void {
    const meeting = this.meeting;
    if (!meeting || this.invitationsBusy()) {
      return;
    }
    this.invitationsBusy.set(true);
    this.store.revokeInvitation(meeting.id, invitation.id).subscribe({
      next: () => {
        this.invitationsBusy.set(false);
        this.loadInvitations();
      },
      error: err => {
        this.invitationsError.set(toApiError(err).message);
        this.invitationsBusy.set(false);
      },
    });
  }

  /** Modo gestionar: manda las invitaciones elegidas y muestra sus joinUrls (única vez). */
  sendInvitations(): void {
    const meeting = this.meeting;
    const drafts = this.invitees();
    if (!meeting || drafts.length === 0 || this.invitationsBusy()) {
      return;
    }
    this.invitationsBusy.set(true);
    this.invitationsError.set(null);
    this.store.createInvitations(meeting.id, drafts).subscribe({
      next: created => {
        this.newInvitationLinks.update(list => [...list, ...created]);
        this.invitees.set([]);
        this.invitationsBusy.set(false);
        this.loadInvitations();
      },
      error: err => {
        this.invitationsError.set(toApiError(err).message);
        this.invitationsBusy.set(false);
      },
    });
  }

  // ---------- Copiar links ----------

  copyToClipboard(key: string, text: string): void {
    navigator.clipboard?.writeText(text).then(() => {
      this.copiedKey.set(key);
      setTimeout(() => {
        if (this.copiedKey() === key) {
          this.copiedKey.set(null);
        }
      }, 2000);
    });
  }

  // ---------- Guardar / cerrar ----------

  close(): void {
    this.closed.emit();
  }

  save(): void {
    if (!this.canSave() || this.busy) {
      return;
    }
    const scheduledForUtc =
      this.date() && this.time() ? new Date(`${this.date()}T${this.time()}`).toISOString() : null;

    if (this.isEditMode()) {
      const meeting = this.meeting;
      if (meeting) {
        this.rescheduleRequested.emit({ meeting, scheduledForUtc });
      }
      return;
    }

    this.createRequested.emit({
      title: this.title().trim(),
      description: this.description().trim(),
      scheduledForUtc,
      invitees: this.invitees(),
    });
  }

  private resetForm(): void {
    const meeting = this.meeting;
    if (meeting) {
      this.title.set(meeting.title);
      if (meeting.scheduledAt) {
        // Fecha/hora en horario LOCAL del usuario (el input date/time es local).
        const scheduled = new Date(meeting.scheduledAt);
        this.date.set(toLocalDateInput(scheduled));
        this.time.set(toLocalTimeInput(scheduled));
      } else {
        this.date.set('');
        this.time.set('');
      }
    } else {
      this.title.set('');
      this.date.set('');
      this.time.set('');
    }
    this.description.set('');
    this.invitees.set([]);
    this.inviteeSearch.set('');
    this.inviteeResults.set({ employees: [], customers: [] });
    this.isInviteeOpen.set(false);
    this.invitations.set([]);
    this.invitationsError.set(null);
    this.newInvitationLinks.set([]);
    this.copiedKey.set(null);
  }
}

function toLocalDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function toLocalTimeInput(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
