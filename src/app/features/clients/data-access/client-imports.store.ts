import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { ClientImportsService } from './client-imports.service';
import {
  CustomerImportAttempt,
  CustomerImportRow,
  DuplicateStrategy,
  isTerminalImport,
} from './client-imports.model';

/** Cadencia del sondeo de `GET /{id}`. La importación es asíncrona: el POST sólo devuelve 202. */
const POLL_INTERVAL_MS = 2000;

/** Tamaño de página del historial (`GET /customers/imports?page&size`). */
export const IMPORT_HISTORY_PAGE_SIZE = 10;

/**
 * Estado del wizard de importación de clientes. Se provee a nivel de ruta (no en 'root')
 * para que al salir de la página se destruya y con ella el temporizador del polling.
 */
@Injectable()
export class ClientImportsStore implements OnDestroy {
  private readonly service = inject(ClientImportsService);

  // ---- Importación en curso / recién terminada ----
  private readonly _attempt = signal<CustomerImportAttempt | null>(null);
  private readonly _starting = signal(false);
  private readonly _startError = signal<string | null>(null);
  private readonly _pollError = signal<string | null>(null);
  private readonly _canceling = signal(false);
  private readonly _cancelError = signal<string | null>(null);

  readonly attempt = this._attempt.asReadonly();
  readonly starting = this._starting.asReadonly();
  readonly startError = this._startError.asReadonly();
  readonly pollError = this._pollError.asReadonly();
  readonly canceling = this._canceling.asReadonly();
  readonly cancelError = this._cancelError.asReadonly();

  // ---- Informe (GET /{id}/report) ----
  private readonly _rows = signal<CustomerImportRow[]>([]);
  private readonly _rowsLoading = signal(false);
  private readonly _rowsError = signal<string | null>(null);
  private readonly _csvDownloading = signal(false);

  readonly rows = this._rows.asReadonly();
  readonly rowsLoading = this._rowsLoading.asReadonly();
  readonly rowsError = this._rowsError.asReadonly();
  readonly csvDownloading = this._csvDownloading.asReadonly();

  // ---- Historial (GET /customers/imports) ----
  private readonly _history = signal<CustomerImportAttempt[]>([]);
  private readonly _historyLoading = signal(false);
  private readonly _historyError = signal<string | null>(null);
  private readonly _historyPage = signal(1);

  readonly history = this._history.asReadonly();
  readonly historyLoading = this._historyLoading.asReadonly();
  readonly historyError = this._historyError.asReadonly();
  readonly historyPage = this._historyPage.asReadonly();

  /** Sin total en la respuesta, "hay siguiente" se deduce de haber recibido la página llena. */
  readonly historyHasMore = computed(() => this._history().length === IMPORT_HISTORY_PAGE_SIZE);

  // ---- Plantilla ----
  private readonly _templateDownloading = signal(false);
  private readonly _templateError = signal<string | null>(null);

  readonly templateDownloading = this._templateDownloading.asReadonly();
  readonly templateError = this._templateError.asReadonly();

  /**
   * El backend sólo permite UNA importación activa por tenant (índice único filtrado:
   * `Import.AlreadyRunning`). Si el historial trae una viva, se ofrece seguirla en vez de
   * dejar al usuario chocando contra el 409.
   */
  readonly runningAttempt = computed(
    () => this._history().find(item => !isTerminalImport(item.status)) ?? null,
  );

  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  ngOnDestroy(): void {
    this.stopPolling();
  }

  // ============ Paso 1: subir ============

  /**
   * POST /customers/imports. `idempotencyKey` la genera la vista y la conserva mientras el
   * archivo elegido no cambie: reintentar tras un error de red devuelve el MISMO intento en
   * vez de importar dos veces.
   */
  start(file: File, strategy: DuplicateStrategy, idempotencyKey: string): void {
    if (this._starting()) {
      return;
    }
    this._starting.set(true);
    this._startError.set(null);
    this._pollError.set(null);
    this._cancelError.set(null);
    this._rows.set([]);
    this._rowsError.set(null);

    this.service.start(file, strategy, idempotencyKey).subscribe({
      next: attempt => {
        this._starting.set(false);
        this.adoptAttempt(attempt);
        this.loadHistory(1);
      },
      error: err => {
        this._starting.set(false);
        this._startError.set(toApiError(err).message);
        // Un `Import.AlreadyRunning` significa que hay otro job vivo: refrescar el historial
        // deja a `runningAttempt` con qué ofrecer el "seguir la importación en curso".
        this.loadHistory(1);
      },
    });
  }

  /** GET /customers/imports/template → descarga directa (el endpoint necesita el JWT). */
  downloadTemplate(): void {
    if (this._templateDownloading()) {
      return;
    }
    this._templateDownloading.set(true);
    this._templateError.set(null);
    this.service.downloadTemplate().subscribe({
      next: blob => {
        this._templateDownloading.set(false);
        saveBlob(blob, 'customer-import-template.csv');
      },
      error: err => {
        this._templateDownloading.set(false);
        this._templateError.set(toApiError(err).message);
      },
    });
  }

  // ============ Paso 2: progreso ============

  /** Adopta una importación (recién creada o elegida del historial) y arranca el sondeo si sigue viva. */
  track(attempt: CustomerImportAttempt): void {
    this._startError.set(null);
    this.adoptAttempt(attempt);
  }

  /** Igual que {@link track} pero partiendo sólo del id: relee el estado antes de mostrarlo. */
  trackById(id: string): void {
    this._pollError.set(null);
    this.service.getById(id).subscribe({
      next: attempt => this.adoptAttempt(attempt),
      error: err => this._pollError.set(toApiError(err).message),
    });
  }

  /** POST /{id}/cancel. El backend pasa a `Canceling` y el worker confirma con `Canceled`. */
  cancel(): void {
    const attempt = this._attempt();
    if (!attempt || this._canceling()) {
      return;
    }
    this._canceling.set(true);
    this._cancelError.set(null);
    this.service.cancel(attempt.id).subscribe({
      next: () => {
        this._canceling.set(false);
        // No se asume el estado: se relee para que la UI muestre lo que el backend decidió.
        this.pollOnce();
      },
      error: err => {
        this._canceling.set(false);
        this._cancelError.set(toApiError(err).message);
      },
    });
  }

  /** Reintenta el sondeo tras un error de red sin perder la importación que se estaba siguiendo. */
  retryPolling(): void {
    this._pollError.set(null);
    this.pollOnce();
  }

  // ============ Paso 3: resultado ============

  /** GET /{id}/report?format=json — todas las filas del intento (OK, saltadas y fallidas). */
  loadReport(id: string): void {
    this._rowsLoading.set(true);
    this._rowsError.set(null);
    this.service.getReportRows(id).subscribe({
      next: rows => {
        this._rows.set(rows);
        this._rowsLoading.set(false);
      },
      error: err => {
        this._rowsError.set(toApiError(err).message);
        this._rowsLoading.set(false);
      },
    });
  }

  /** GET /{id}/report?format=csv — mismo informe, descargable. */
  downloadReportCsv(): void {
    const attempt = this._attempt();
    if (!attempt || this._csvDownloading()) {
      return;
    }
    this._csvDownloading.set(true);
    this.service.downloadReportCsv(attempt.id).subscribe({
      next: blob => {
        this._csvDownloading.set(false);
        saveBlob(blob, `import-${attempt.id}.csv`);
      },
      error: err => {
        this._csvDownloading.set(false);
        this._rowsError.set(toApiError(err).message);
      },
    });
  }

  /** Vuelve al paso 1 dejando el historial cargado. */
  reset(): void {
    this.stopPolling();
    this._attempt.set(null);
    this._rows.set([]);
    this._rowsError.set(null);
    this._startError.set(null);
    this._pollError.set(null);
    this._cancelError.set(null);
  }

  // ============ Historial ============

  loadHistory(page: number): void {
    const target = Math.max(1, page);
    this._historyPage.set(target);
    this._historyLoading.set(true);
    this._historyError.set(null);
    this.service.search(target, IMPORT_HISTORY_PAGE_SIZE).subscribe({
      next: items => {
        this._history.set(items ?? []);
        this._historyLoading.set(false);
      },
      error: err => {
        this._historyError.set(toApiError(err).message);
        this._historyLoading.set(false);
      },
    });
  }

  // ============ Internos ============

  private adoptAttempt(attempt: CustomerImportAttempt): void {
    this._attempt.set(attempt);
    this._pollError.set(null);
    if (isTerminalImport(attempt.status)) {
      this.stopPolling();
      this.loadReport(attempt.id);
      return;
    }
    this._rows.set([]);
    this.schedulePoll();
  }

  /**
   * Sondeo encadenado con setTimeout (y no con setInterval) para que nunca se solapen dos
   * GET si el backend tarda más que el intervalo.
   */
  private schedulePoll(): void {
    this.stopPolling();
    this.pollTimer = setTimeout(() => this.pollOnce(), POLL_INTERVAL_MS);
  }

  private pollOnce(): void {
    const current = this._attempt();
    if (!current) {
      return;
    }
    this.service.getById(current.id).subscribe({
      next: attempt => {
        this._attempt.set(attempt);
        this._pollError.set(null);
        if (isTerminalImport(attempt.status)) {
          this.stopPolling();
          this.loadReport(attempt.id);
          this.loadHistory(this._historyPage());
          return;
        }
        this.schedulePoll();
      },
      error: err => {
        // Se corta el sondeo y se ofrece Retry: reintentar en bucle contra un backend caído
        // sólo llena la consola de errores y consume el rate limit de `imports_get`.
        this.stopPolling();
        this._pollError.set(toApiError(err).message);
      },
    });
  }

  private stopPolling(): void {
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }
}

/** Descarga un blob ya autenticado creando un object URL efímero (mismo patrón que mfa-setup-page). */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
