import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, concatMap, map, of, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { AuthService } from '@core/auth/auth.service';
import { ClientRemindersService } from './client-reminders.service';
import {
  ClientReminderRow,
  REMINDER_CANCEL_REASON,
  REMINDER_DEFAULT_CATEGORY,
  ReminderResponse,
  newRequestKey,
  toClientReminderRow,
  toLocalDateInput,
  toLocalTimeInput,
  toUtcIso,
} from './client-reminders.model';

/** Valores del formulario de alta/edición (fecha y hora en LOCAL, como los inputs). */
export interface ReminderFormValue {
  title: string;
  body: string;
  date: string;
  time: string;
}

/**
 * Store de la pestaña "Reminders" del perfil de cliente (Reminder.Api vía `/reminders`).
 *
 * ⚠️ La lista NO está filtrada por cliente y no puede estarlo: el contrato de Reminder no
 * tiene categoría `Customer` ni ningún listado por target (ver cabecera de
 * `client-reminders.model.ts`). Lo que se muestra son los recordatorios del usuario
 * logueado — la pestaña lo dice explícitamente en pantalla en vez de simular un filtro.
 *
 * Reparto de errores igual que en Task/Notes: `error` (listado, con Retry) vs `actionError`
 * (banner descartable); el alta/edición devuelve Observable para el error del modal.
 */
@Injectable({ providedIn: 'root' })
export class ClientRemindersStore {
  private readonly service = inject(ClientRemindersService);
  private readonly auth = inject(AuthService);

  private readonly _raw = signal<ReminderResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _actionError = signal<string | null>(null);
  private readonly _busyIds = signal<ReadonlySet<string>>(new Set());

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly actionError = this._actionError.asReadonly();

  readonly reminders = computed<ClientReminderRow[]>(() =>
    this._raw()
      .map(toClientReminderRow)
      .sort((a, b) => a.fireAtUtc.localeCompare(b.fireAtUtc)),
  );

  isBusy(id: string): boolean {
    return this._busyIds().has(id);
  }

  clearActionError(): void {
    this._actionError.set(null);
  }

  /**
   * GET /reminders/mine sin filtro de estado: los pills de estado filtran en memoria para
   * que el conteo de la cabecera y la paginación de UI trabajen sobre el mismo conjunto.
   * Tope de 100 filas (`size` máximo del controller) — sin más paginación server-side en v1.
   */
  load(): void {
    this._loading.set(true);
    this._error.set(null);
    this.service.listMine().subscribe({
      next: result => {
        this._raw.set(result.items);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  // ---------- Alta / edición (el modal muestra el error) ----------

  /**
   * POST /reminders con `category: 'General'` y sin `targetId`: es la única combinación que
   * `ReminderTarget` acepta sin objetivo (T1 rechaza `General` + targetId; T2 exige target
   * para el resto de categorías). El schedule es absoluto — no hay ancla que seguir.
   */
  create(form: ReminderFormValue): Observable<void> {
    return this.service
      .create({
        title: form.title.trim(),
        body: form.body.trim() || null,
        category: REMINDER_DEFAULT_CATEGORY,
        targetId: null,
        fireAtUtc: toUtcIso(form.date, form.time),
        anchorAtUtc: null,
        leadMinutes: null,
        timeZone: this.timeZoneId(),
        requestKey: newRequestKey(),
      })
      .pipe(
        tap(created => this._raw.update(list => [created, ...list])),
        map(() => undefined),
      );
  }

  /**
   * Edición en dos llamadas encadenadas, cada una solo si su campo cambió: PUT /subject
   * (título/cuerpo) y PUT /schedule (fecha/hora). El backend no tiene un update combinado.
   */
  update(row: ClientReminderRow, form: ReminderFormValue): Observable<void> {
    const baseline = this._raw().find(reminder => reminder.id === row.id);
    if (!baseline) {
      return of(undefined);
    }

    const title = form.title.trim();
    const body = form.body.trim();
    const subjectChanged = title !== baseline.title || body !== (baseline.body ?? '');
    const scheduleChanged =
      form.date !== toLocalDateInput(baseline.fireAtUtc) || form.time !== toLocalTimeInput(baseline.fireAtUtc);

    let stream: Observable<ReminderResponse> = of(baseline);
    if (subjectChanged) {
      stream = stream.pipe(
        concatMap(latest => this.service.updateSubject(latest.id, { title, body: body || null })),
      );
    }
    if (scheduleChanged && row.canReschedule) {
      stream = stream.pipe(
        concatMap(latest =>
          this.service.updateSchedule(latest.id, {
            fireAtUtc: toUtcIso(form.date, form.time),
            anchorAtUtc: null,
            leadMinutes: null,
          }),
        ),
      );
    }

    return stream.pipe(
      tap(updated => this.replace(updated)),
      map(() => undefined),
    );
  }

  // ---------- Acciones sueltas (banner descartable) ----------

  snooze(id: string, minutes: number): void {
    this.runAction(id, this.service.snooze(id, minutes));
  }

  dismiss(id: string): void {
    this.runAction(id, this.service.dismiss(id));
  }

  /** DELETE /reminders/{id} — cancela (no borra). La razón es obligatoria en el aggregate. */
  cancel(id: string): void {
    this.runAction(id, this.service.cancel(id, REMINDER_CANCEL_REASON));
  }

  // ---------- Internos ----------

  private runAction(id: string, action: Observable<ReminderResponse>): void {
    this.markBusy(id, true);
    action.subscribe({
      next: updated => {
        this.replace(updated);
        this.markBusy(id, false);
      },
      error: err => {
        this._actionError.set(toApiError(err).message);
        this.markBusy(id, false);
      },
    });
  }

  private replace(updated: ReminderResponse): void {
    this._raw.update(list => list.map(reminder => (reminder.id === updated.id ? updated : reminder)));
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

  /** Zona IANA del recordatorio: la del perfil del usuario, o la del navegador. */
  private timeZoneId(): string {
    return this.auth.currentUser()?.timeZoneId || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
