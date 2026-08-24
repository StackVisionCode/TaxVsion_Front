import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  ApiTaskStatus,
  AssignTaskRequest,
  CancelTaskRequest,
  ChangeTaskDueRequest,
  ChangeTaskPriorityRequest,
  CreateTaskRequest,
  EmployeeDirectoryEntry,
  PagedResult,
  TaskBoardApiResponse,
  TaskClientSummary,
  TaskResponse,
  TaskUserSummary,
  UpdateTaskDetailsRequest,
  WaitOnClientRequest,
} from './task.model';

interface SearchTasksParams {
  q?: string;
  status?: ApiTaskStatus;
  page?: number;
  size?: number;
}

/**
 * Cliente HTTP fino sobre TasksController (`/tasks`, servicio Tasks.Api vía Gateway).
 * Incluye además las dos llamadas mínimas replicadas de otros servicios (patrón
 * documents-clients / chat-directory, sin imports cross-feature):
 *  - GET /communication/directory/employees → picker de asignado (q obligatorio, limit ≤ 25).
 *  - GET /customers → picker de cliente y resolución de nombres en tarjetas.
 *  - GET /auth/users → best-effort para nombres de asignados (requiere permiso users.view).
 */
@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/tasks');
  }

  // ---------- Tablero + búsqueda ----------

  /** GET /tasks/board — solo abiertas (excluye Completed/Cancelled), tope 500. */
  board(): Observable<TaskBoardApiResponse> {
    return this.http.get<TaskBoardApiResponse>(`${this.base}/board`);
  }

  /** GET /tasks/search — el filtro de texto es `q` (no `term`); paginado con `page`/`size`. */
  search(params: SearchTasksParams): Observable<PagedResult<TaskResponse>> {
    let query = new HttpParams();
    if (params.q) {
      query = query.set('q', params.q);
    }
    if (params.status) {
      query = query.set('status', params.status);
    }
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.size) {
      query = query.set('size', params.size);
    }
    return this.http.get<PagedResult<TaskResponse>>(`${this.base}/search`, { params: query });
  }

  // ---------- CRUD ----------

  getById(id: string): Observable<TaskResponse> {
    return this.http.get<TaskResponse>(`${this.base}/${id}`);
  }

  create(req: CreateTaskRequest): Observable<TaskResponse> {
    return this.http.post<TaskResponse>(this.base, req);
  }

  /** PUT /tasks/{id} — solo título y descripción; el resto va por endpoints dedicados. */
  updateDetails(id: string, req: UpdateTaskDetailsRequest): Observable<TaskResponse> {
    return this.http.put<TaskResponse>(`${this.base}/${id}`, req);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  // ---------- Campos dedicados ----------

  changePriority(id: string, req: ChangeTaskPriorityRequest): Observable<TaskResponse> {
    return this.http.put<TaskResponse>(`${this.base}/${id}/priority`, req);
  }

  changeDue(id: string, req: ChangeTaskDueRequest): Observable<TaskResponse> {
    return this.http.put<TaskResponse>(`${this.base}/${id}/due`, req);
  }

  assign(id: string, req: AssignTaskRequest): Observable<TaskResponse> {
    return this.http.put<TaskResponse>(`${this.base}/${id}/assignee`, req);
  }

  unassign(id: string): Observable<TaskResponse> {
    return this.http.delete<TaskResponse>(`${this.base}/${id}/assignee`);
  }

  // ---------- Transiciones de estado ----------

  start(id: string): Observable<TaskResponse> {
    return this.http.post<TaskResponse>(`${this.base}/${id}/start`, {});
  }

  complete(id: string): Observable<TaskResponse> {
    return this.http.post<TaskResponse>(`${this.base}/${id}/complete`, {});
  }

  reopen(id: string): Observable<TaskResponse> {
    return this.http.post<TaskResponse>(`${this.base}/${id}/reopen`, {});
  }

  cancel(id: string, req: CancelTaskRequest): Observable<TaskResponse> {
    return this.http.post<TaskResponse>(`${this.base}/${id}/cancel`, req);
  }

  waitOnClient(id: string, req: WaitOnClientRequest): Observable<TaskResponse> {
    return this.http.post<TaskResponse>(`${this.base}/${id}/wait-on-client`, req);
  }

  // ---------- Llamadas replicadas de otros servicios ----------

  /** GET /communication/directory/employees — q obligatorio (min 1 char), limit máx 25. */
  searchEmployees(term: string, limit = 10): Observable<EmployeeDirectoryEntry[]> {
    const params = new HttpParams().set('q', term).set('limit', limit);
    return this.http.get<EmployeeDirectoryEntry[]>(
      `${this.api.tenantUrl('/communication/directory')}/employees`,
      { params },
    );
  }

  /** GET /customers — lote para el picker de cliente y para resolver nombres en tarjetas. */
  searchClients(term: string, size = 200): Observable<PagedResult<TaskClientSummary>> {
    let params = new HttpParams().set('status', 'NotArchived').set('size', size);
    if (term.trim()) {
      params = params.set('term', term.trim());
    }
    return this.http.get<PagedResult<TaskClientSummary>>(this.api.tenantUrl('/customers'), { params });
  }

  /** GET /auth/users — nombres de asignados. Best-effort: sin permiso users.view devuelve 403. */
  listUsers(size = 200): Observable<PagedResult<TaskUserSummary>> {
    const params = new HttpParams().set('page', 1).set('size', size);
    return this.http.get<PagedResult<TaskUserSummary>>(this.api.tenantUrl('/auth/users'), { params });
  }
}
