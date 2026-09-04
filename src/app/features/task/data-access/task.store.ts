import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, concatMap, forkJoin, map, of, switchMap, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { AuthService } from '@core/auth/auth.service';
import { TaskService } from './task.service';
import {
  ApiTaskStatus,
  ChangeTaskDueRequest,
  CreateTaskRequest,
  EmployeeDirectoryEntry,
  TaskClientSummary,
  TaskFormValue,
  TaskItem,
  TaskResponse,
  TaskStatus,
  statusToColumn,
  toTaskItem,
} from './task.model';

/** Cuántas Completed recientes se traen aparte: /tasks/board es OnlyOpen y no las incluye. */
const COMPLETED_FETCH_SIZE = 50;
/** Tamaño de página del listado server-paginado (modo búsqueda). */
const SEARCH_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function isClosed(status: ApiTaskStatus): boolean {
  return status === 'Completed' || status === 'Cancelled';
}

/**
 * Store del módulo Task (Tasks.Api vía /tasks). providedIn: 'root' — una sola instancia
 * para la ruta del módulo. Guarda los TaskResponse crudos y deriva las tarjetas con
 * computed(): así los nombres de cliente/asignado se re-resuelven solos cuando llegan
 * los catálogos (GET /customers, GET /auth/users best-effort, directorio de Communication).
 */
@Injectable({ providedIn: 'root' })
export class TaskStore {
  private readonly service = inject(TaskService);
  private readonly auth = inject(AuthService);

  // ---------- Estado crudo ----------
  private readonly _raw = signal<TaskResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  /** Error transitorio de una acción (drag, guardado…): banner descartable, no rompe el tablero. */
  private readonly _actionError = signal<string | null>(null);
  private readonly _search = signal('');
  private readonly _searchPage = signal(1);
  private readonly _searchTotalCount = signal(0);
  /** Renombres de columna por tenant (label → estado). Vacío = se usan los nombres por defecto. */
  private readonly _labelOverrides = signal<ReadonlyMap<TaskStatus, string>>(new Map());
  /** Filtros server-side (van a /tasks/search). null = sin filtro. */
  private readonly _filterAssignee = signal<string | null>(null);
  private readonly _filterCustomer = signal<string | null>(null);
  private readonly _filterTaxYear = signal<number | null>(null);
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  // ---------- Catálogos para nombres/pickers ----------
  private readonly _clients = signal<TaskClientSummary[]>([]);
  private readonly _userNames = signal<ReadonlyMap<string, string>>(new Map());

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly actionError = this._actionError.asReadonly();
  readonly search = this._search.asReadonly();
  readonly clients = this._clients.asReadonly();

  /** Modo búsqueda = hay término O algún filtro → resultados server-paginados de /tasks/search. */
  readonly isSearching = computed(
    () => this._search().trim().length > 0 || this.hasActiveFilters(),
  );
  readonly hasActiveFilters = computed(
    () => this._filterAssignee() !== null || this._filterCustomer() !== null || this._filterTaxYear() !== null,
  );
  readonly searchPage = this._searchPage.asReadonly();
  readonly searchTotalCount = this._searchTotalCount.asReadonly();
  readonly searchPageSize = SEARCH_PAGE_SIZE;
  readonly labelOverrides = this._labelOverrides.asReadonly();
  readonly filterAssignee = this._filterAssignee.asReadonly();
  readonly filterCustomer = this._filterCustomer.asReadonly();
  readonly filterTaxYear = this._filterTaxYear.asReadonly();

  /** Opciones de asignado para el picker de filtro (de los nombres ya resueltos). */
  readonly assigneeOptions = computed(() =>
    [...this._userNames().entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  );

  private readonly clientNameById = computed<ReadonlyMap<string, string>>(
    () => new Map(this._clients().map(client => [client.id, client.displayName])),
  );

  /** Tarjetas del tablero (las Cancelled quedan fuera: no tienen columna). */
  readonly tasks = computed<TaskItem[]>(() => {
    const clients = this.clientNameById();
    const users = this._userNames();
    return this._raw()
      .map(response => toTaskItem(response, clients, users))
      .filter((item): item is TaskItem => item !== null);
  });

  // ---------- Carga ----------

  /** Carga inicial idempotente: tablero + catálogos de nombres. */
  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.registerCurrentUserName();
    this.loadClients();
    this.loadUserNames();
    this.loadTaxonomies();
    this.refresh();
  }

  /** Recarga los labels del tenant (p.ej. tras editarlos en el manager). Público, idempotente. */
  loadTaxonomies(): void {
    this.service.taxonomies().subscribe({
      next: tax => {
        const map = new Map<TaskStatus, string>();
        for (const label of tax.labels) {
          const column = statusToColumn(label.mapsToStatus);
          // Primer label por estado gana; Cancelled no tiene columna en el tablero.
          if (column && !map.has(column)) {
            map.set(column, label.displayName);
          }
        }
        this._labelOverrides.set(map);
      },
      error: () => {
        /* best-effort: sin taxonomías se usan los nombres por defecto */
      },
    });
  }

  refresh(): void {
    if (this.isSearching()) {
      this.loadSearch();
    } else {
      this.loadBoard();
    }
  }

  /** Fija los filtros server-side (assignee/customer/taxYear) y recarga (vuelve a la primera página). */
  setFilters(patch: { assignee?: string | null; customer?: string | null; taxYear?: number | null }): void {
    if (patch.assignee !== undefined) this._filterAssignee.set(patch.assignee);
    if (patch.customer !== undefined) this._filterCustomer.set(patch.customer);
    if (patch.taxYear !== undefined) this._filterTaxYear.set(patch.taxYear);
    this._searchPage.set(1);
    this.refresh();
  }

  clearFilters(): void {
    this._filterAssignee.set(null);
    this._filterCustomer.set(null);
    this._filterTaxYear.set(null);
    this._searchPage.set(1);
    this.refresh();
  }

  /** Búsqueda contra GET /tasks/search?q= (con debounce); término vacío vuelve al tablero. */
  setSearch(term: string): void {
    this._search.set(term);
    this._searchPage.set(1); // nuevo término → primera página
    if (this.searchDebounce !== null) {
      clearTimeout(this.searchDebounce);
    }
    this.searchDebounce = setTimeout(() => {
      this.searchDebounce = null;
      this.refresh();
    }, SEARCH_DEBOUNCE_MS);
  }

  /** Cambia de página en modo búsqueda (sin debounce). */
  setSearchPage(page: number): void {
    if (page < 1 || !this.isSearching()) {
      return;
    }
    this._searchPage.set(page);
    this.loadSearch();
  }

  clearActionError(): void {
    this._actionError.set(null);
  }

  /**
   * GET /tasks/board trae solo abiertas (OnlyOpen excluye Completed/Cancelled), así que la
   * columna Completed se alimenta aparte con GET /tasks/search?status=Completed.
   */
  private loadBoard(): void {
    this._loading.set(true);
    this._error.set(null);
    forkJoin({
      board: this.service.board(),
      completed: this.service.search({ status: 'Completed', size: COMPLETED_FETCH_SIZE }),
    }).subscribe({
      next: ({ board, completed }) => {
        const open = board.columns.flatMap(column => column.tasks);
        const openIds = new Set(open.map(task => task.id));
        const merged = [...open, ...completed.items.filter(task => !openIds.has(task.id))];
        this._raw.set(merged);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  private loadSearch(): void {
    this._loading.set(true);
    this._error.set(null);
    const term = this._search().trim();
    this.service
      .search({
        ...(term ? { q: term } : {}),
        ...(this._filterAssignee() ? { assigneeUserId: this._filterAssignee()! } : {}),
        ...(this._filterCustomer() ? { customerId: this._filterCustomer()! } : {}),
        ...(this._filterTaxYear() ? { taxYear: this._filterTaxYear()! } : {}),
        page: this._searchPage(),
        size: SEARCH_PAGE_SIZE,
      })
      .subscribe({
        next: result => {
          this._raw.set(result.items);
          this._searchTotalCount.set(result.totalCount);
          this._loading.set(false);
        },
        error: err => {
          this._error.set(toApiError(err).message);
          this._loading.set(false);
        },
      });
  }

  // ---------- Catálogos ----------

  private loadClients(): void {
    this.service.searchClients('').subscribe({
      next: result => this._clients.set(result.items),
      error: err => console.warn('Tasks: no se pudo cargar el picker de clientes:', toApiError(err).message),
    });
  }

  /** Nombres de asignados vía GET /auth/users. Best-effort: sin users.view (403) las tarjetas caen a "Team member". */
  private loadUserNames(): void {
    this.service.listUsers().subscribe({
      next: result =>
        this.mergeUserNames(result.items.map(user => [user.id, `${user.name} ${user.lastName}`.trim()])),
      error: err =>
        console.warn('Tasks: no se pudieron resolver nombres de usuarios:', toApiError(err).message),
    });
  }

  private registerCurrentUserName(): void {
    const me = this.auth.currentUser();
    if (me) {
      this.mergeUserNames([[me.id, `${me.name} ${me.lastName}`.trim()]]);
    }
  }

  private mergeUserNames(entries: Array<[string, string]>): void {
    if (entries.length === 0) {
      return;
    }
    this._userNames.update(current => {
      const next = new Map(current);
      for (const [id, name] of entries) {
        if (name) {
          next.set(id, name);
        }
      }
      return next;
    });
  }

  /** Type-ahead del picker de asignado (directorio de Communication, q min 1 / limit ≤ 25). */
  searchEmployees(term: string): Observable<EmployeeDirectoryEntry[]> {
    return this.service.searchEmployees(term).pipe(
      tap(entries => this.mergeUserNames(entries.map(entry => [entry.userId, entry.displayName]))),
    );
  }

  // ---------- Crear / editar / borrar ----------

  createTask(form: TaskFormValue): Observable<void> {
    const req: CreateTaskRequest = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority,
      assigneeUserId: form.assignee?.userId ?? null,
      customerId: form.customerId,
      taxYear: null,
      dueAtUtc: form.dueDate ? `${form.dueDate}T00:00:00Z` : null,
      dueTimeZoneId: form.dueDate ? this.timeZoneId() : null,
      dueIsStatutory: false,
      estimatedHours: null,
    };
    return this.service.create(req).pipe(
      switchMap(created => this.applyStatusTransition(created, form)),
      tap(final => this._raw.update(list => [final, ...list])),
      map(() => undefined),
    );
  }

  /**
   * Edición: PUT /tasks/{id} para título/descripción + endpoints dedicados para prioridad,
   * vencimiento y asignado, encadenados solo cuando el campo cambió; la transición de
   * estado va al final (y un reopen va primero si la tarea estaba cerrada).
   */
  updateTask(current: TaskItem, form: TaskFormValue): Observable<void> {
    const baseline = this._raw().find(response => response.id === current.id);
    if (!baseline) {
      return of(undefined);
    }

    const steps: Array<(latest: TaskResponse) => Observable<TaskResponse> | null> = [];

    // Reabrir primero si estaba cerrada y el usuario la saca de Completed: los endpoints
    // de detalle rechazan mutar una tarea cerrada (InvalidTransition).
    steps.push(latest =>
      isClosed(latest.status) && form.status !== statusToColumn(latest.status)
        ? this.service.reopen(latest.id)
        : null,
    );

    const title = form.title.trim();
    const description = form.description.trim();
    steps.push(latest =>
      title !== latest.title || description !== (latest.description ?? '')
        ? this.service.updateDetails(latest.id, { title, description: description || null })
        : null,
    );

    steps.push(latest =>
      form.priority !== latest.priority
        ? this.service.changePriority(latest.id, { priority: form.priority })
        : null,
    );

    steps.push(latest => {
      const currentDue = latest.dueAtUtc ? latest.dueAtUtc.slice(0, 10) : '';
      if (form.dueDate === currentDue) {
        return null;
      }
      const req: ChangeTaskDueRequest = {
        dueAtUtc: form.dueDate ? `${form.dueDate}T00:00:00Z` : null,
        timeZoneId: form.dueDate ? this.timeZoneId() : null,
        isStatutory: form.dueDate ? latest.dueIsStatutory : false,
        statutoryChangeReason: null,
      };
      return this.service.changeDue(latest.id, req);
    });

    steps.push(latest => {
      const wanted = form.assignee?.userId ?? null;
      if (wanted === latest.assigneeUserId) {
        return null;
      }
      return wanted === null
        ? this.service.unassign(latest.id)
        : this.service.assign(latest.id, { assigneeUserId: wanted });
    });

    steps.push(latest => this.applyStatusTransition(latest, form));

    let stream: Observable<TaskResponse> = of(baseline);
    for (const step of steps) {
      stream = stream.pipe(concatMap(latest => step(latest) ?? of(latest)));
    }
    return stream.pipe(
      tap(final => this.replaceRaw(final)),
      map(() => undefined),
    );
  }

  deleteTask(id: string): Observable<void> {
    return this.service.delete(id).pipe(
      tap(() => this._raw.update(list => list.filter(response => response.id !== id))),
      map(() => undefined),
    );
  }

  /** POST /tasks/{id}/cancel — razón obligatoria. La tarea cancelada sale del tablero. */
  cancelTask(id: string, reason: string): Observable<void> {
    return this.service.cancel(id, { reason: reason.trim() }).pipe(
      tap(final => this.replaceRaw(final)),
      map(() => undefined),
    );
  }

  // ---------- Drag & drop ----------

  /**
   * Cambio de columna por drag (o los puntos de la tarjeta) → transición real:
   *   → In Progress:  start (reopen→start si venía cerrada)
   *   → Completed:    complete
   *   → Not Started:  reopen (solo válido desde Completed/Cancelled)
   *   → Waiting:      rechazado acá — exige `expectedItems`, se hace desde el panel.
   * Optimista: la tarjeta ya se movió en el tablero; si la API falla se revierte y
   * se muestra el error.
   */
  moveTask(id: string, target: TaskStatus): void {
    const snapshot = this._raw();
    const raw = snapshot.find(response => response.id === id);
    if (!raw || statusToColumn(raw.status) === target) {
      return;
    }

    const plan = this.transitionPlan(raw, target);
    if (typeof plan === 'string') {
      // Sin llamada: repone el tablero (nueva referencia → el board rearma sus buckets).
      this._raw.set([...snapshot]);
      this._actionError.set(plan);
      return;
    }

    const optimistic = this.optimisticStatusFor(target);
    this._raw.update(list =>
      list.map(response => (response.id === id ? { ...response, status: optimistic } : response)),
    );

    plan.subscribe({
      next: final => this.replaceRaw(final),
      error: err => {
        this._raw.set(snapshot);
        this._actionError.set(toApiError(err).message);
      },
    });
  }

  private transitionPlan(raw: TaskResponse, target: TaskStatus): Observable<TaskResponse> | string {
    switch (target) {
      case 'not-started':
        return isClosed(raw.status)
          ? this.service.reopen(raw.id)
          : 'A task that already started can only be reopened from Completed — it cannot go back to Not Started.';
      case 'in-progress':
        if (isClosed(raw.status)) {
          return this.service
            .reopen(raw.id)
            .pipe(switchMap(reopened => (reopened.status === 'NotStarted' ? this.service.start(reopened.id) : of(reopened))));
        }
        return this.service.start(raw.id);
      case 'completed':
        if (raw.status === 'Cancelled') {
          return this.service.reopen(raw.id).pipe(switchMap(reopened => this.service.complete(reopened.id)));
        }
        return this.service.complete(raw.id);
      case 'waiting':
        return 'Moving to "Waiting on Client" needs the list of items requested from the client — open the task and change its status there.';
    }
  }

  private optimisticStatusFor(target: TaskStatus): ApiTaskStatus {
    switch (target) {
      case 'not-started':
        return 'NotStarted';
      case 'in-progress':
        return 'InProgress';
      case 'waiting':
        return 'WaitingOnClient';
      case 'completed':
        return 'Completed';
    }
  }

  // ---------- Helpers ----------

  /** Lleva una tarea recién creada/editada al estado elegido en el panel (start/complete/wait-on-client). */
  private applyStatusTransition(latest: TaskResponse, form: TaskFormValue): Observable<TaskResponse> {
    if (statusToColumn(latest.status) === form.status) {
      return of(latest);
    }
    switch (form.status) {
      case 'not-started':
        return isClosed(latest.status) ? this.service.reopen(latest.id) : of(latest);
      case 'in-progress':
        if (isClosed(latest.status)) {
          return this.service
            .reopen(latest.id)
            .pipe(switchMap(reopened => (reopened.status === 'NotStarted' ? this.service.start(reopened.id) : of(reopened))));
        }
        return this.service.start(latest.id);
      case 'completed':
        if (latest.status === 'Cancelled') {
          return this.service.reopen(latest.id).pipe(switchMap(reopened => this.service.complete(reopened.id)));
        }
        return this.service.complete(latest.id);
      case 'waiting': {
        const request = { expectedItems: form.expectedItems.trim(), clientDueAtUtc: null };
        if (isClosed(latest.status)) {
          return this.service
            .reopen(latest.id)
            .pipe(switchMap(reopened => this.service.waitOnClient(reopened.id, request)));
        }
        return this.service.waitOnClient(latest.id, request);
      }
    }
  }

  private replaceRaw(final: TaskResponse): void {
    this._raw.update(list => list.map(response => (response.id === final.id ? final : response)));
  }

  /** Zona del vencimiento: la configurada en el perfil del usuario, o la del navegador. */
  private timeZoneId(): string {
    return this.auth.currentUser()?.timeZoneId || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
