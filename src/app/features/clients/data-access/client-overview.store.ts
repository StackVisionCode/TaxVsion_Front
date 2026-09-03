import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { ClientWorkService } from './client-work.service';
import { ClientCommunicationService } from './client-communication.service';
import { ApiTaskPriority, ApiTaskStatus, WorkTaskItem, toWorkTaskItem } from './client-work.model';
import { ClientEmailThreadRow, toClientEmailThreadRow } from './client-communication.model';

/** Estados abiertos: todo lo que no está cerrado (Completed) ni cancelado (Cancelled). */
const OPEN_STATUSES: ApiTaskStatus[] = ['NotStarted', 'InProgress', 'WaitingOnClient'];

/** El Overview no muestra asignados, así que no resuelve nombres: mapa vacío para `toWorkTaskItem`. */
const NO_NAMES = new Map<string, string>();

/** Orden de urgencia para "Needs attention" (vencidas primero, luego por prioridad). */
const PRIORITY_RANK: Record<ApiTaskPriority, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

/** Cuántas filas se muestran en cada tarjeta de resumen. */
const NEEDS_ATTENTION_MAX = 5;
const RECENT_ACTIVITY_MAX = 4;

/**
 * Store del "360 de un vistazo" del tab Overview. Agrega tres listados REALES por cliente que ya
 * existen en el backend — tareas (`GET /tasks/by-customer`), documentos
 * (`GET /storage/files?ownerType=Customer`) e hilos de email
 * (`GET /correspondence/customers/{id}/threads`) — para las stats y las tarjetas "Needs attention"
 * (tareas abiertas priorizadas) y "Recent activity" (hilos recientes).
 *
 * Cada lectura tolera un 403/permiso parcial (`catchError` → vacío): sin `tasks.read` el contador de
 * tareas queda en 0 en vez de romper toda la vista. `providedIn: 'root'` con estado por cliente:
 * `load(id)` limpia si cambió el cliente. No muta nada — es solo lectura de resumen.
 */
@Injectable({ providedIn: 'root' })
export class ClientOverviewStore {
  private readonly work = inject(ClientWorkService);
  private readonly cloud = inject(CloudStorageUploadService);
  private readonly comm = inject(ClientCommunicationService);

  private clientId = '';

  private readonly _openTasks = signal<WorkTaskItem[]>([]);
  private readonly _docsCount = signal(0);
  private readonly _threads = signal<ClientEmailThreadRow[]>([]);
  private readonly _loading = signal(false);

  readonly loading = this._loading.asReadonly();

  readonly openTaskCount = computed(() => this._openTasks().length);
  readonly docsCount = this._docsCount.asReadonly();
  readonly threadCount = computed(() => this._threads().length);

  /** Tareas abiertas priorizadas: vencidas primero, luego por prioridad, luego por vencimiento más cercano. */
  readonly needsAttention = computed<WorkTaskItem[]>(() =>
    [...this._openTasks()]
      .sort((a, b) => {
        if (a.overdue !== b.overdue) {
          return a.overdue ? -1 : 1;
        }
        const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (byPriority !== 0) {
          return byPriority;
        }
        // Las que tienen fecha van antes que las que no; entre ellas, la más próxima primero.
        return (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31');
      })
      .slice(0, NEEDS_ATTENTION_MAX),
  );

  /** Hilos de email más recientes (ya vienen ordenados desc por `load`). */
  readonly recentActivity = computed<ClientEmailThreadRow[]>(() => this._threads().slice(0, RECENT_ACTIVITY_MAX));

  load(clientId: string): void {
    if (clientId !== this.clientId) {
      this.clientId = clientId;
      this._openTasks.set([]);
      this._docsCount.set(0);
      this._threads.set([]);
    }
    if (!this.clientId) {
      return;
    }
    this._loading.set(true);
    forkJoin({
      tasks: this.work.byCustomer(this.clientId).pipe(catchError(() => of(null))),
      docs: this.cloud.listFiles(0, 100, 'Customer', this.clientId).pipe(catchError(() => of([]))),
      threads: this.comm.listThreads(this.clientId).pipe(catchError(() => of(null))),
    }).subscribe(({ tasks, docs, threads }) => {
      const open = (tasks?.items ?? [])
        .filter(task => OPEN_STATUSES.includes(task.status))
        .map(task => toWorkTaskItem(task, NO_NAMES));
      this._openTasks.set(open);
      this._docsCount.set(docs?.length ?? 0);
      const rows = (threads?.items ?? [])
        .map(toClientEmailThreadRow)
        .sort((a, b) => b.lastMessageTime - a.lastMessageTime);
      this._threads.set(rows);
      this._loading.set(false);
    });
  }
}
