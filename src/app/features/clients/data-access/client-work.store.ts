import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, concatMap, map, of, switchMap, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { AuthService } from '@core/auth/auth.service';
import { ClientWorkService } from './client-work.service';
import {
  ApiTaskStatus,
  ChangeTaskDueRequest,
  CreateTaskRequest,
  EmployeeDirectoryEntry,
  TaskResponse,
  WorkColumnId,
  WorkTaskFormValue,
  WorkTaskItem,
  statusToColumn,
  toWorkTaskItem,
} from './client-work.model';

/** Lote del listado por cliente (los clientes rara vez pasan de esto; el backend topa `size` en 100). */
const FETCH_SIZE = 100;

function isClosed(status: ApiTaskStatus): boolean {
  return status === 'Completed' || status === 'Cancelled';
}

/**
 * Store de la pestaña "Work" del perfil de cliente (Tasks.Api vía `/tasks/by-customer/{id}`).
 *
 * `providedIn: 'root'` con estado por cliente: la pestaña se destruye/recrea al cambiar de tab
 * (`*ngSwitchCase`), así que `load(customerId)` limpia el estado si el cliente cambió y siempre
 * pide datos frescos. Guarda los TaskResponse crudos y deriva las tarjetas con computed(), para
 * que los nombres de asignado se re-resuelvan solos cuando llega el catálogo (GET /auth/users).
 *
 * Reparto de errores, igual que Notes/Task: `error` es el fallo del listado (con Retry),
 * `actionError` es el banner descartable de una acción suelta; los flujos de formulario
 * (alta/edición) devuelven el Observable para que el componente muestre el error junto al editor.
 */
@Injectable({ providedIn: 'root' })
export class ClientWorkStore {
  private readonly service = inject(ClientWorkService);
  private readonly auth = inject(AuthService);

  private customerId = '';
  private userNamesLoaded = false;

  private readonly _raw = signal<TaskResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _actionError = signal<string | null>(null);
  private readonly _busyIds = signal<ReadonlySet<string>>(new Set());
  private readonly _userNames = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _totalCount = signal(0);

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly actionError = this._actionError.asReadonly();
  readonly totalCount = this._totalCount.asReadonly();

  /** Todas las tareas del cliente (incluidas Cancelled, que la vista pliega aparte). */
  readonly tasks = computed<WorkTaskItem[]>(() => {
    const names = this._userNames();
    return this._raw().map(response => toWorkTaskItem(response, names));
  });

  /** Conteo por sección para las cabeceras (Cancelled va aparte con `column === null`). */
  readonly countByColumn = computed<Record<WorkColumnId, number>>(() => {
    const counts: Record<WorkColumnId, number> = {
      'not-started': 0,
      'in-progress': 0,
      waiting: 0,
      completed: 0,
    };
    for (const task of this.tasks()) {
      if (task.column) {
        counts[task.column]++;
      }
    }
    return counts;
  });

  readonly cancelledCount = computed(() => this.tasks().filter(task => task.column === null).length);
  readonly openCount = computed(
    () => this.tasks().filter(task => task.apiStatus !== 'Completed' && task.apiStatus !== 'Cancelled').length,
  );

  isBusy(id: string): boolean {
    return this._busyIds().has(id);
  }

  clearActionError(): void {
    this._actionError.set(null);
  }

  tasksInColumn(column: WorkColumnId): WorkTaskItem[] {
    return this.tasks().filter(task => task.column === column);
  }

  cancelledTasks(): WorkTaskItem[] {
    return this.tasks().filter(task => task.column === null);
  }

  /** Carga (o recarga) las tareas del cliente indicado. */
  load(customerId: string): void {
    if (customerId !== this.customerId) {
      this.customerId = customerId;
      this._raw.set([]);
      this._actionError.set(null);
    }
    this.loadUserNamesOnce();
    this.refresh();
  }

  refresh(): void {
    if (!this.customerId) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this.service.byCustomer(this.customerId, 1, FETCH_SIZE).subscribe({
      next: result => {
        this._raw.set(result.items);
        this._totalCount.set(result.totalCount);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  // ---------- Alta / edición (el componente muestra el error junto al editor) ----------

  createTask(form: WorkTaskFormValue): Observable<void> {
    const req: CreateTaskRequest = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority,
      assigneeUserId: form.assignee?.userId ?? null,
      customerId: this.customerId,
      taxYear: null,
      dueAtUtc: form.dueDate ? `${form.dueDate}T00:00:00Z` : null,
      dueTimeZoneId: form.dueDate ? this.timeZoneId() : null,
      dueIsStatutory: false,
      estimatedHours: null,
    };
    return this.service.create(req).pipe(
      switchMap(created => this.applyStatusTransition(created, form)),
      tap(final => {
        this._raw.update(list => [final, ...list]);
        this._totalCount.update(count => count + 1);
      }),
      map(() => undefined),
    );
  }

  /**
   * Edición: PUT /tasks/{id} para título/descripción + endpoints dedicados para prioridad,
   * vencimiento y asignado, encadenados solo cuando el campo cambió; la transición de estado
   * va al final (y un reopen va primero si la tarea estaba cerrada).
   */
  updateTask(current: WorkTaskItem, form: WorkTaskFormValue): Observable<void> {
    const baseline = this._raw().find(response => response.id === current.id);
    if (!baseline) {
      return of(undefined);
    }

    const steps: Array<(latest: TaskResponse) => Observable<TaskResponse> | null> = [];

    // Reabrir primero si estaba cerrada y el usuario la saca de ese estado: los endpoints de
    // detalle rechazan mutar una tarea cerrada (InvalidTransition).
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

  // ---------- Acciones sueltas (banner descartable) ----------

  /** Transición directa desde el menú de la fila (start/complete/reopen). */
  moveTo(task: WorkTaskItem, target: WorkColumnId): void {
    const raw = this._raw().find(response => response.id === task.id);
    if (!raw || statusToColumn(raw.status) === target) {
      return;
    }
    const plan = this.transitionPlan(raw, target);
    if (typeof plan === 'string') {
      this._actionError.set(plan);
      return;
    }
    this.runAction(task.id, plan);
  }

  /** POST /tasks/{id}/wait-on-client — expectedItems obligatorio. */
  waitOnClient(task: WorkTaskItem, expectedItems: string, clientDueAtUtc: string | null): Observable<void> {
    const raw = this._raw().find(response => response.id === task.id);
    const request = { expectedItems: expectedItems.trim(), clientDueAtUtc };
    const call =
      raw && isClosed(raw.status)
        ? this.service.reopen(task.id).pipe(switchMap(reopened => this.service.waitOnClient(reopened.id, request)))
        : this.service.waitOnClient(task.id, request);
    return call.pipe(
      tap(final => this.replaceRaw(final)),
      map(() => undefined),
    );
  }

  /** POST /tasks/{id}/cancel — razón obligatoria. */
  cancelTask(task: WorkTaskItem, reason: string): Observable<void> {
    return this.service.cancel(task.id, { reason: reason.trim() }).pipe(
      tap(final => this.replaceRaw(final)),
      map(() => undefined),
    );
  }

  /** DELETE /tasks/{id} — 204; la tarea desaparece del listado. */
  remove(id: string): void {
    this.markBusy(id, true);
    this.service.delete(id).subscribe({
      next: () => {
        this._raw.update(list => list.filter(response => response.id !== id));
        this._totalCount.update(count => Math.max(0, count - 1));
        this.markBusy(id, false);
      },
      error: err => {
        this._actionError.set(toApiError(err).message);
        this.markBusy(id, false);
      },
    });
  }

  /** Type-ahead del picker de asignado (directorio de Communication, q min 1 / limit ≤ 25). */
  searchEmployees(term: string): Observable<EmployeeDirectoryEntry[]> {
    return this.service.searchEmployees(term).pipe(
      tap(entries => this.mergeUserNames(entries.map(entry => [entry.userId, entry.displayName]))),
    );
  }

  // ---------- Internos ----------

  private runAction(id: string, action: Observable<TaskResponse>): void {
    this.markBusy(id, true);
    action.subscribe({
      next: final => {
        this.replaceRaw(final);
        this.markBusy(id, false);
      },
      error: err => {
        this._actionError.set(toApiError(err).message);
        this.markBusy(id, false);
      },
    });
  }

  /**
   * Plan de transición por menú:
   *   → not-started: reopen (solo válido desde Completed/Cancelled)
   *   → in-progress: start (reopen→start si venía cerrada)
   *   → completed:   complete (reopen→complete si venía cancelada)
   *   → waiting:     rechazado acá — exige expectedItems, se hace desde el diálogo dedicado.
   */
  private transitionPlan(raw: TaskResponse, target: WorkColumnId): Observable<TaskResponse> | string {
    switch (target) {
      case 'not-started':
        return isClosed(raw.status)
          ? this.service.reopen(raw.id)
          : 'A task that already started can only be reopened from Completed — it cannot go back to Not started.';
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
        return 'Moving to "Waiting on client" needs the list of items requested — use "Request from client" on the task.';
    }
  }

  /** Lleva una tarea recién creada/editada al estado elegido en el editor. */
  private applyStatusTransition(latest: TaskResponse, form: WorkTaskFormValue): Observable<TaskResponse> {
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

  private markBusy(id: string, busy: boolean): void {
    this._busyIds.update(current => {
      const next = new Set(current);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  /**
   * Nombres de asignados: el usuario logueado (siempre) + GET /auth/users best-effort.
   * Sin `users.view` el listado responde 403 y los asignados ajenos quedan como "Team member".
   */
  private loadUserNamesOnce(): void {
    if (this.userNamesLoaded) {
      return;
    }
    this.userNamesLoaded = true;

    const me = this.auth.currentUser();
    if (me) {
      this.mergeUserNames([[me.id, `${me.name} ${me.lastName}`.trim()]]);
    }

    this.service.listUsers().subscribe({
      next: result => this.mergeUserNames(result.items.map(user => [user.id, `${user.name} ${user.lastName}`.trim()])),
      error: err => console.warn('Client work: no se pudieron resolver nombres de asignados:', toApiError(err).message),
    });
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

  /** Zona del vencimiento: la del perfil del usuario, o la del navegador. */
  private timeZoneId(): string {
    return this.auth.currentUser()?.timeZoneId || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
