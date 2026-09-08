import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  AssignTaskRequest,
  CancelTaskRequest,
  ChangeTaskDueRequest,
  ChangeTaskPriorityRequest,
  CreateTaskRequest,
  EmployeeDirectoryEntry,
  PagedResult,
  TaskResponse,
  UpdateTaskDetailsRequest,
  WaitOnClientRequest,
  WorkUserSummary,
} from './client-work.model';

/**
 * Cliente HTTP fino sobre TasksController (`/tasks`, servicio Tasks.Api vía Gateway) para la
 * pestaña "Work" del perfil. Autocontenido (no importa `features/task`): el listado es el
 * endpoint REAL por cliente `GET /tasks/by-customer/{customerId}`, y cada transición usa su
 * verbo/ruta dedicada (no hay un "set status" genérico). Incluye además la llamada replicada
 * a GET /communication/directory/employees (picker de asignado) y GET /auth/users
 * (best-effort para nombres), igual que el módulo Task.
 */
@Injectable({ providedIn: 'root' })
export class ClientWorkService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private get base(): string {
    return this.api.tenantUrl('/tasks');
  }

  /** GET /tasks/by-customer/{customerId} — todas las tareas de este cliente, paginado (size 1..100). */
  byCustomer(customerId: string, page = 1, size = 100): Observable<PagedResult<TaskResponse>> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<PagedResult<TaskResponse>>(`${this.base}/by-customer/${customerId}`, { params });
  }

  // ---------- CRUD ----------

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

  /** GET /auth/users — nombres de asignados. Best-effort: sin permiso users.view devuelve 403. */
  listUsers(size = 200): Observable<PagedResult<WorkUserSummary>> {
    const params = new HttpParams().set('page', 1).set('size', size);
    return this.http.get<PagedResult<WorkUserSummary>>(this.api.tenantUrl('/auth/users'), { params });
  }
}
