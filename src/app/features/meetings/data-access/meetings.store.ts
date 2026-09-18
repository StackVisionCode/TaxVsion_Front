import { Injectable, computed, inject, signal, type WritableSignal } from '@angular/core';
import { Observable, forkJoin, map, of, switchMap, tap } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { toApiError } from '@core/models/api-error.model';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { MeetingsService } from './meetings.service';
import {
  CreatedMeetingInvitation,
  MeetingCustomerEntry,
  MeetingEmployeeEntry,
  MeetingFormValue,
  MeetingInviteeDraft,
  MeetingInviteeInput,
  MeetingItem,
  MeetingListItemResponse,
  MeetingsScope,
  MeetingStatsResponse,
  toMeetingItem,
} from './meeting.model';

const EMPTY_STATS: MeetingStatsResponse = { today: 0, thisWeek: 0, liveNow: 0, transcriptsAvailable: 0 };

const PAGE_SIZE = 20;

/** Estado de una pestaña (upcoming/past): items crudos + paginación acumulada. */
interface ScopeState {
  responses: MeetingListItemResponse[];
  page: number;
  totalCount: number;
  loaded: boolean;
}

const EMPTY_SCOPE: ScopeState = { responses: [], page: 0, totalCount: 0, loaded: false };

/** Resultado de crear meeting + invitaciones (los joinUrl solo existen acá). */
export interface MeetingCreationOutcome {
  meetingId: string;
  shortCode: string;
  invitations: CreatedMeetingInvitation[];
}

/** Resultado agrupado del type-ahead del picker de invitados. */
export interface InviteeSearchResult {
  employees: MeetingEmployeeEntry[];
  customers: MeetingCustomerEntry[];
}

/**
 * Store del módulo Meetings (Communication vía /communication). providedIn:
 * 'root' — una sola instancia para la ruta. Guarda las respuestas crudas por
 * scope y deriva las filas con computed() usando el usuario actual (para saber
 * si es host). Las acciones de lifecycle parchean el estado local en vez de
 * re-listar todo; cancelar/terminar invalida la pestaña "past" para que se
 * recargue al visitarla.
 */
@Injectable({ providedIn: 'root' })
export class MeetingsStore {
  private readonly service = inject(MeetingsService);
  private readonly auth = inject(AuthService);
  private readonly storage = inject(CloudStorageUploadService);
  private readonly realtime = inject(CommunicationRealtimeService);
  private realtimeBound = false;

  // ---------- Estado ----------
  private readonly _upcoming = signal<ScopeState>(EMPTY_SCOPE);
  private readonly _past = signal<ScopeState>(EMPTY_SCOPE);
  private readonly _stats = signal<MeetingStatsResponse>(EMPTY_STATS);
  /** Contadores reales del backend para las tarjetas (no dependen de la paginación del cliente). */
  readonly stats = this._stats.asReadonly();
  private readonly _loading = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _error = signal<string | null>(null);
  /** Error transitorio de una acción (start/end/cancel…): banner descartable. */
  private readonly _actionError = signal<string | null>(null);

  readonly loading = this._loading.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly error = this._error.asReadonly();
  readonly actionError = this._actionError.asReadonly();

  /** El backend exige `communication.meeting.create` para agendar. */
  readonly canCreate = computed(
    () => this.auth.currentUser()?.permissions.includes('communication.meeting.create') ?? false,
  );

  readonly upcoming = computed<MeetingItem[]>(() => this.mapScope(this._upcoming()));
  readonly past = computed<MeetingItem[]>(() => this.mapScope(this._past()));

  private mapScope(state: ScopeState): MeetingItem[] {
    const me = this.auth.currentUser()?.id ?? null;
    return state.responses.map(response => toMeetingItem(response, me));
  }

  meetingsFor(scope: MeetingsScope): MeetingItem[] {
    return scope === 'upcoming' ? this.upcoming() : this.past();
  }

  hasMore(scope: MeetingsScope): boolean {
    const state = this.scopeSignal(scope)();
    return state.loaded && state.responses.length < state.totalCount;
  }

  private scopeSignal(scope: MeetingsScope): WritableSignal<ScopeState> {
    return scope === 'upcoming' ? this._upcoming : this._past;
  }

  clearActionError(): void {
    this._actionError.set(null);
  }

  // ---------- Realtime ----------

  /**
   * Suscribe la lista a los avisos del socket compartido (idempotente): cuando me invitan a un
   * meeting (`meeting.invited`) o el host arranca uno al que estoy invitado (`meeting.started`), y
   * tras un reconnect del socket, refresca "upcoming" en silencio (sin spinner). Sin esto, un
   * invitado no veía el meeting aparecer hasta recargar la página. Lo llama la página en ngOnInit.
   */
  bindRealtime(): void {
    if (this.realtimeBound) {
      return;
    }
    this.realtimeBound = true;
    // Invitado o meeting iniciado → aparece/cambia en "upcoming".
    this.realtime.on<{ meetingId: string }>('meeting.invited').subscribe(() => {
      this.refreshScopeSilently('upcoming');
      this.loadStats();
    });
    this.realtime.on<{ meetingId: string }>('meeting.started').subscribe(() => {
      this.refreshScopeSilently('upcoming');
      this.loadStats();
    });
    // Meeting terminado → sale de "upcoming" y entra a "past": refrescar ambos + contadores.
    this.realtime.on<{ meetingId: string }>('meeting.ended').subscribe(() => {
      this.refreshScopeSilently('upcoming');
      this.refreshScopeSilently('past');
      this.loadStats();
    });
    this.realtime.reconnected$.subscribe(() => {
      this.refreshScopeSilently('upcoming');
      this.refreshScopeSilently('past');
      this.loadStats();
    });
  }

  /** Carga los contadores reales del backend para las tarjetas (best-effort). */
  loadStats(): void {
    this.service.stats().subscribe({
      next: stats => this._stats.set(stats),
      error: () => undefined,
    });
  }

  /** Re-lista la primera página de un scope YA cargado sin togglear el loading global (refresh de fondo). */
  private refreshScopeSilently(scope: MeetingsScope): void {
    const target = this.scopeSignal(scope);
    if (!target().loaded) {
      return;
    }
    this.service.list({ scope, page: 1, size: PAGE_SIZE }).subscribe({
      next: result => target.set({ responses: result.items, page: 1, totalCount: result.totalCount, loaded: true }),
      error: () => undefined, // best-effort: un refresh fallido no rompe la vista actual
    });
  }

  // ---------- Carga ----------

  /** Carga (lazy) la primera página de un scope; con force re-lista desde cero. */
  loadScope(scope: MeetingsScope, force = false): void {
    const target = this.scopeSignal(scope);
    if (target().loaded && !force) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this.service.list({ scope, page: 1, size: PAGE_SIZE }).subscribe({
      next: result => {
        target.set({ responses: result.items, page: 1, totalCount: result.totalCount, loaded: true });
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  /** Página siguiente del scope (append). */
  loadMore(scope: MeetingsScope): void {
    const target = this.scopeSignal(scope);
    const current = target();
    if (!current.loaded || this._loadingMore()) {
      return;
    }
    const nextPage = current.page + 1;
    this._loadingMore.set(true);
    this.service.list({ scope, page: nextPage, size: PAGE_SIZE }).subscribe({
      next: result => {
        const known = new Set(current.responses.map(item => item.id));
        target.set({
          responses: [...current.responses, ...result.items.filter(item => !known.has(item.id))],
          page: nextPage,
          totalCount: result.totalCount,
          loaded: true,
        });
        this._loadingMore.set(false);
      },
      error: err => {
        this._actionError.set(toApiError(err).message);
        this._loadingMore.set(false);
      },
    });
  }

  // ---------- Crear ----------

  /**
   * POST /meetings y, si el panel eligió invitados, POST /meetings/{id}/invitations.
   * Devuelve shortCode + joinUrls: es la ÚNICA oportunidad de mostrarlos (el
   * token nunca se re-expone). Al final refresca "upcoming".
   */
  createMeeting(form: MeetingFormValue): Observable<MeetingCreationOutcome> {
    const invitees = form.invitees.map(toInviteeInput);
    const passcode = form.passcode?.trim();
    return this.service
      .create({
        title: form.title.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.scheduledForUtc ? { scheduledForUtc: form.scheduledForUtc } : {}),
        // El default del backend es 4: con más invitados quedaría corta la sala.
        // Host + invitados + margen de 1, acotado al rango válido [2..100].
        ...(invitees.length > 0
          ? { maxParticipants: Math.min(100, Math.max(4, invitees.length + 2)) }
          : {}),
        // SIEMPRE explícito: el default del backend es `true`, así que omitirlo cuando está en false
        // dejaba la sala de espera encendida aunque el usuario la desmarcara.
        requireWaitingRoom: form.requireWaitingRoom,
        ...(passcode ? { passcode } : {}),
        ...(form.recordingRequested ? { recordingRequested: true } : {}),
      })
      .pipe(
        switchMap(created =>
          invitees.length === 0
            ? of<MeetingCreationOutcome>({ meetingId: created.meetingId, shortCode: created.shortCode, invitations: [] })
            : this.service.createInvitations(created.meetingId, invitees).pipe(
                map(result => ({
                  meetingId: created.meetingId,
                  shortCode: created.shortCode,
                  invitations: [...result.invitations],
                })),
              ),
        ),
        tap(() => {
          this.loadScope('upcoming', true);
          this.loadStats();
        }),
      );
  }

  // ---------- Lifecycle ----------

  /** Host-only: Scheduled → Live. Parchea la fila localmente. */
  startMeeting(id: string): Observable<void> {
    return this.service.start(id).pipe(
      tap(result => {
        this.patchUpcoming(id, item => ({ ...item, status: 'Live', startedAtUtc: result.startedAtUtc }));
        this.loadStats();
      }),
      map(() => undefined),
    );
  }

  /** Termina el meeting para todos; sale de "upcoming" y pasa al historial. */
  endMeeting(id: string): Observable<void> {
    return this.service.end(id).pipe(
      tap(() => {
        this.moveOutOfUpcoming(id);
        this.loadStats();
      }),
      map(() => undefined),
    );
  }

  /** Host-only, solo Scheduled. El meeting cancelado pasa al historial. */
  cancelMeeting(id: string, reason?: string): Observable<void> {
    return this.service.cancel(id, reason).pipe(
      tap(() => {
        this.moveOutOfUpcoming(id);
        this.loadStats();
      }),
    );
  }

  /** Host/cohost, solo Scheduled. null = des-agendar (instantáneo). */
  rescheduleMeeting(id: string, newScheduledForUtc: string | null): Observable<void> {
    return this.service
      .reschedule(id, newScheduledForUtc)
      .pipe(tap(() => this.patchUpcoming(id, item => ({ ...item, scheduledForUtc: newScheduledForUtc }))));
  }

  private patchUpcoming(id: string, mutate: (item: MeetingListItemResponse) => MeetingListItemResponse): void {
    this._upcoming.update(state => ({
      ...state,
      responses: state.responses.map(item => (item.id === id ? mutate(item) : item)),
    }));
  }

  /** Saca la fila de upcoming e invalida past (se recarga al visitar la pestaña). */
  private moveOutOfUpcoming(id: string): void {
    this._upcoming.update(state => ({
      ...state,
      responses: state.responses.filter(item => item.id !== id),
      totalCount: Math.max(0, state.totalCount - 1),
    }));
    this._past.set(EMPTY_SCOPE);
  }

  // ---------- Invitaciones (panel de gestión) ----------

  listInvitations(meetingId: string) {
    return this.service.listInvitations(meetingId).pipe(map(result => result.invitations));
  }

  createInvitations(meetingId: string, invitees: MeetingInviteeDraft[]): Observable<CreatedMeetingInvitation[]> {
    return this.service
      .createInvitations(meetingId, invitees.map(toInviteeInput))
      .pipe(map(result => [...result.invitations]));
  }

  revokeInvitation(meetingId: string, invitationId: string): Observable<void> {
    return this.service.revokeInvitation(meetingId, invitationId);
  }

  // ---------- Picker de invitados ----------

  /** Type-ahead sobre el directorio de Communication (employees + customers en paralelo, best-effort). */
  searchInvitees(term: string): Observable<InviteeSearchResult> {
    const q = term.trim();
    if (!q) {
      return of({ employees: [], customers: [] });
    }
    return forkJoin({
      employees: this.service.searchEmployees(q).pipe(catchError(() => of([] as MeetingEmployeeEntry[]))),
      customers: this.service.searchCustomers(q).pipe(catchError(() => of([] as MeetingCustomerEntry[]))),
    });
  }

  // ---------- Transcript ----------

  /** Link presignado de descarga del transcript (POST /storage/files/{id}/download-url). */
  transcriptUrl(fileId: string): Observable<string> {
    return this.storage.getDownloadUrl(fileId).pipe(map(result => result.downloadUrl));
  }
}

/** El backend resuelve el userId destino: employee por userId, customer por customerId, external por email. */
function toInviteeInput(draft: MeetingInviteeDraft): MeetingInviteeInput {
  return {
    kind: draft.kind,
    ...(draft.userId ? { userId: draft.userId } : {}),
    ...(draft.customerId ? { customerId: draft.customerId } : {}),
    ...(draft.email ? { email: draft.email } : {}),
    ...(draft.name ? { name: draft.name } : {}),
  };
}
