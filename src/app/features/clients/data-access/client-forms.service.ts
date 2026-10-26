import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';
import { Observable } from 'rxjs';
import type { DataCollectionFieldComment } from '@shared/ui/data-collection/data-collection.models';
import type {
  AssignClientFormInput,
  AssignableClientFormTemplate,
  ClientFormPage,
  ClientFormRequestDetail,
  ClientFormRequestRow,
  ClientFormRequestValue,
  ClientFormRevision,
} from './client-forms.model';

@Injectable({ providedIn: 'root' })
export class ClientFormsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/tasks/forms');
  }

  list(customerId: string): Observable<ClientFormPage<ClientFormRequestRow>> {
    const params = new HttpParams()
      .set('customerId', customerId)
      .set('view', 'All')
      .set('page', 1)
      .set('pageSize', 100);
    return this.http.get<ClientFormPage<ClientFormRequestRow>>(`${this.base}/requests`, { params });
  }

  detail(id: string): Observable<ClientFormRequestDetail> {
    return this.http.get<ClientFormRequestDetail>(`${this.base}/requests/${id}`);
  }

  revision(id: string, number: number): Observable<ClientFormRevision> {
    return this.http.get<ClientFormRevision>(`${this.base}/requests/${id}/revisions/${number}`);
  }

  templates(search = ''): Observable<AssignableClientFormTemplate[]> {
    const params = search ? new HttpParams().set('search', search) : undefined;
    return this.http.get<AssignableClientFormTemplate[]>(`${this.base}/templates/assignable`, {
      params,
    });
  }

  assign(input: AssignClientFormInput): Observable<ClientFormRequestValue> {
    return this.http.post<ClientFormRequestValue>(`${this.base}/requests`, input);
  }

  returnForChanges(
    id: string,
    message: string,
    fieldComments: DataCollectionFieldComment[],
    rowVersion: string,
  ): Observable<ClientFormRequestValue> {
    return this.http.post<ClientFormRequestValue>(`${this.base}/requests/${id}/return`, {
      message,
      fieldComments,
      rowVersion,
    });
  }

  complete(
    id: string,
    internalNote: string | null,
    rowVersion: string,
  ): Observable<ClientFormRequestValue> {
    return this.http.post<ClientFormRequestValue>(`${this.base}/requests/${id}/complete`, {
      internalNote,
      rowVersion,
    });
  }

  cancel(id: string, note: string | null, rowVersion: string): Observable<ClientFormRequestValue> {
    return this.http.post<ClientFormRequestValue>(`${this.base}/requests/${id}/cancel`, {
      note,
      rowVersion,
    });
  }

  dueDate(
    id: string,
    dueAtUtc: string | null,
    rowVersion: string,
  ): Observable<ClientFormRequestValue> {
    return this.http.put<ClientFormRequestValue>(`${this.base}/requests/${id}/due-date`, {
      dueAtUtc,
      rowVersion,
    });
  }

  reveal(id: string, sensitiveAnswerId: string): Observable<{ value: string; kind: string }> {
    return this.http.post<{ value: string; kind: string }>(
      `${this.base}/requests/${id}/sensitive-answers/${sensitiveAnswerId}/reveal`,
      {},
    );
  }
}
