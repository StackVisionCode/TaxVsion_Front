import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import {
  AddDependencyRequest,
  ApiTaskStatus,
  AssignTaskRequest,
  CancelTaskRequest,
  CreateSubtaskRequest,
  ChangeTaskDueRequest,
  ChangeTaskPriorityRequest,
  CreateTaskRequest,
  EmployeeDirectoryEntry,
  PagedResult,
  TaskBoardApiResponse,
  TaskCalendarEntry,
  ApplyTaskTemplateRequest,
  SaveTaskTemplateAttachmentsRequest,
  SaveTaskTemplateRequest,
  SetTaskTemplateActiveRequest,
  TaskAttachmentResponse,
  TaskAttachmentUpsertRequest,
  TaskClientSummary,
  TaskTemplateResponse,
  TemplateApplicationResponse,
  TaskDependencyGraphResponse,
  CreateTaskSeriesRequest,
  SeriesStatus,
  TaskLabelResponse,
  TaskResponse,
  TaskSeriesResponse,
  TaskTaxonomiesResponse,
  UpsertTaskLabelRequest,
  TaskTimerResponse,
  TaskUserSummary,
  StartTimerRequest,
  UpdateTaskDetailsRequest,
  WaitOnClientRequest,
} from './task.model';

interface SearchTasksParams {
  q?: string;
  status?: ApiTaskStatus;
  assigneeUserId?: string;
  customerId?: string;
  taxYear?: number;
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
    if (params.assigneeUserId) {
      query = query.set('assigneeUserId', params.assigneeUserId);
    }
    if (params.customerId) {
      query = query.set('customerId', params.customerId);
    }
    if (params.taxYear) {
      query = query.set('taxYear', params.taxYear);
    }
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.size) {
      query = query.set('size', params.size);
    }
    return this.http.get<PagedResult<TaskResponse>>(`${this.base}/search`, { params: query });
  }

  /** GET /tasks/calendar — tareas con fecha en el rango (requiere from/to; tope 500, sin paginación). */
  calendar(fromUtc: string, toUtc: string, assigneeUserId?: string): Observable<TaskCalendarEntry[]> {
    let params = new HttpParams().set('fromUtc', fromUtc).set('toUtc', toUtc);
    if (assigneeUserId) {
      params = params.set('assigneeUserId', assigneeUserId);
    }
    return this.http.get<TaskCalendarEntry[]>(`${this.base}/calendar`, { params });
  }

  // ---------- CRUD ----------

  getById(id: string): Observable<TaskResponse> {
    return this.http.get<TaskResponse>(`${this.base}/${id}`);
  }

  /** GET /tasks/{id}/graph — grafo de dependencias aguas arriba (para el badge "Bloqueada por N"). */
  graph(id: string): Observable<TaskDependencyGraphResponse> {
    return this.http.get<TaskDependencyGraphResponse>(`${this.base}/${id}/graph`);
  }

  // ---------- Subtareas + dependencias (F4) ----------

  /** GET /tasks/{id}/subtasks — hijas directas, paginado. */
  subtasks(id: string, page = 1, size = 100): Observable<PagedResult<TaskResponse>> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<PagedResult<TaskResponse>>(`${this.base}/${id}/subtasks`, { params });
  }

  createSubtask(id: string, req: CreateSubtaskRequest): Observable<TaskResponse> {
    return this.http.post<TaskResponse>(`${this.base}/${id}/subtasks`, req);
  }

  addDependency(id: string, req: AddDependencyRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/dependencies`, req);
  }

  removeDependency(id: string, dependsOnTaskId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/dependencies/${dependsOnTaskId}`);
  }

  // ---------- Adjuntos (F5) — el byte va a CloudStorage; aquí solo el fileId ----------

  attachments(taskId: string, includeDescendants = false): Observable<TaskAttachmentResponse[]> {
    const params = new HttpParams().set('includeDescendants', includeDescendants);
    return this.http.get<TaskAttachmentResponse[]>(`${this.base}/${taskId}/attachments`, { params });
  }

  /** Vincular un archivo YA escaneado (nace Available). */
  linkAttachment(taskId: string, req: TaskAttachmentUpsertRequest): Observable<TaskAttachmentResponse> {
    return this.http.post<TaskAttachmentResponse>(`${this.base}/${taskId}/attachments/link`, req);
  }

  /** "Upload" (JSON, NO multipart): registra el fileId; nace Pending hasta el veredicto del escaneo. */
  uploadAttachment(taskId: string, req: TaskAttachmentUpsertRequest): Observable<TaskAttachmentResponse> {
    return this.http.post<TaskAttachmentResponse>(`${this.base}/${taskId}/attachments`, req);
  }

  deleteAttachment(taskId: string, fileId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${taskId}/attachments/${fileId}`);
  }

  // ---------- Plantillas fiscales (F8) ----------

  listTemplates(onlyActive = true): Observable<TaskTemplateResponse[]> {
    const params = new HttpParams().set('onlyActive', onlyActive);
    return this.http.get<TaskTemplateResponse[]>(`${this.base}/templates`, { params });
  }

  /** Siembra el catálogo estándar (1040 / 1040-ES / 941). Idempotente por nombre. */
  installStandardTemplates(): Observable<TaskTemplateResponse[]> {
    return this.http.post<TaskTemplateResponse[]>(`${this.base}/templates/install-standard`, {});
  }

  applyTemplate(templateId: string, req: ApplyTaskTemplateRequest): Observable<TemplateApplicationResponse> {
    return this.http.post<TemplateApplicationResponse>(`${this.base}/templates/${templateId}/apply`, req);
  }

  getTemplate(templateId: string): Observable<TaskTemplateResponse> {
    return this.http.get<TaskTemplateResponse>(`${this.base}/templates/${templateId}`);
  }

  createTemplate(req: SaveTaskTemplateRequest): Observable<TaskTemplateResponse> {
    return this.http.post<TaskTemplateResponse>(`${this.base}/templates`, req);
  }

  updateTemplate(templateId: string, req: SaveTaskTemplateRequest): Observable<TaskTemplateResponse> {
    return this.http.put<TaskTemplateResponse>(`${this.base}/templates/${templateId}`, req);
  }

  setTemplateActive(templateId: string, req: SetTaskTemplateActiveRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/templates/${templateId}/active`, req);
  }

  /** PUT /tasks/templates/{id}/attachments — reemplaza el set de archivos de referencia (byte en CloudStorage). */
  setTemplateAttachments(templateId: string, req: SaveTaskTemplateAttachmentsRequest): Observable<TaskTemplateResponse> {
    return this.http.put<TaskTemplateResponse>(`${this.base}/templates/${templateId}/attachments`, req);
  }

  // ---------- Timers (F10) ----------

  timers(taskId: string): Observable<TaskTimerResponse[]> {
    return this.http.get<TaskTimerResponse[]>(`${this.base}/${taskId}/timers`);
  }

  startTimer(taskId: string, req: StartTimerRequest): Observable<TaskTimerResponse> {
    return this.http.post<TaskTimerResponse>(`${this.base}/${taskId}/timer/start`, req);
  }

  stopTimer(taskId: string, timerId: string): Observable<TaskTimerResponse> {
    return this.http.post<TaskTimerResponse>(`${this.base}/${taskId}/timer/${timerId}/stop`, {});
  }

  // ---------- Series / recurrencia (F9) ----------

  createSeries(req: CreateTaskSeriesRequest): Observable<TaskSeriesResponse> {
    return this.http.post<TaskSeriesResponse>(`${this.base}/series`, req);
  }

  listSeries(status?: SeriesStatus): Observable<TaskSeriesResponse[]> {
    let params = new HttpParams();
    if (status) {
      params = params.set('status', status);
    }
    return this.http.get<TaskSeriesResponse[]>(`${this.base}/series`, { params });
  }

  pauseSeries(id: string): Observable<TaskSeriesResponse> {
    return this.http.post<TaskSeriesResponse>(`${this.base}/series/${id}/pause`, {});
  }

  resumeSeries(id: string): Observable<TaskSeriesResponse> {
    return this.http.post<TaskSeriesResponse>(`${this.base}/series/${id}/resume`, {});
  }

  endSeries(id: string): Observable<TaskSeriesResponse> {
    return this.http.post<TaskSeriesResponse>(`${this.base}/series/${id}/end`, {});
  }

  // ---------- Etiquetas / taxonomías (F11) ----------

  /** GET /tasks/taxonomies — estados/prioridades del server + labels del tenant (renombran estados). */
  taxonomies(): Observable<TaskTaxonomiesResponse> {
    return this.http.get<TaskTaxonomiesResponse>(`${this.base}/taxonomies`);
  }

  createLabel(req: UpsertTaskLabelRequest): Observable<TaskLabelResponse> {
    return this.http.post<TaskLabelResponse>(`${this.base}/labels`, req);
  }

  updateLabel(id: string, req: UpsertTaskLabelRequest): Observable<TaskLabelResponse> {
    return this.http.put<TaskLabelResponse>(`${this.base}/labels/${id}`, req);
  }

  deleteLabel(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/labels/${id}`);
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
