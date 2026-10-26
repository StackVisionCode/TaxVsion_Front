import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';
import { Observable, forkJoin, map, of, switchMap } from 'rxjs';
import type {
  AssignExternalFormRequestInput,
  AssignFormRequestInput,
  ActiveConsentNotice,
  AssignableFormTemplate,
  FormActionRun,
  FormFieldComment,
  FormRequest,
  FormRequestFilters,
  FormRequestListItem,
  FormRequestRevision,
  PagedResult,
  StaffFormRequestDetail,
  StaffMemberOption,
} from './client-forms.model';

interface AuthUserRow {
  id: string;
  name: string;
  lastName: string;
  email: string;
  isActive: boolean;
}

interface AuthUserPage {
  items: AuthUserRow[];
  totalCount: number;
}

// `auth/users` admite como mucho 100 por página.
const STAFF_PAGE_SIZE = 100;
const STAFF_MAX_PAGES = 20;

@Injectable({ providedIn: 'root' })
export class FormRequestsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  private get base(): string {
    return this.api.tenantUrl('/tasks/forms');
  }

  list(filters: FormRequestFilters = {}): Observable<PagedResult<FormRequestListItem>> {
    let params = new HttpParams();
    for (const [key, raw] of Object.entries(filters)) {
      if (raw == null || raw === '') continue;
      if (Array.isArray(raw)) {
        for (const value of raw)
          params = params.append(key === 'statuses' ? 'status' : key, String(value));
      } else {
        params = params.set(key, String(raw));
      }
    }
    return this.http.get<PagedResult<FormRequestListItem>>(`${this.base}/requests`, { params });
  }

  get(id: string): Observable<StaffFormRequestDetail> {
    return this.http.get<StaffFormRequestDetail>(`${this.base}/requests/${id}`);
  }

  revision(id: string, revisionNumber: number): Observable<FormRequestRevision> {
    return this.http.get<FormRequestRevision>(
      `${this.base}/requests/${id}/revisions/${revisionNumber}`,
    );
  }

  assign(input: AssignFormRequestInput): Observable<FormRequest> {
    return this.http.post<FormRequest>(`${this.base}/requests`, input);
  }

  /** 201 con `FormRequestResponse`, igual que el assign a un cliente. */
  assignExternal(input: AssignExternalFormRequestInput): Observable<FormRequest> {
    return this.http.post<FormRequest>(`${this.base}/requests/external`, input);
  }

  /** 204: rota el token del acceso y reenvía el enlace (máximo 5 emisiones). */
  resendExternalAccess(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/requests/${id}/external-access/resend`, {});
  }

  /** Avisos de entrada (D-35): activos, con propósito IdentityVerification y su última versión. */
  entryNotices(): Observable<ActiveConsentNotice[]> {
    const params = new HttpParams().set('purpose', 'IdentityVerification');
    return this.http.get<ActiveConsentNotice[]>(`${this.base}/consent-notices/active`, { params });
  }

  returnForChanges(
    id: string,
    message: string,
    fieldComments: FormFieldComment[],
    rowVersion: string,
  ): Observable<FormRequest> {
    return this.http.post<FormRequest>(`${this.base}/requests/${id}/return`, {
      message,
      fieldComments,
      rowVersion,
    });
  }

  complete(id: string, internalNote: string | null, rowVersion: string): Observable<FormRequest> {
    return this.http.post<FormRequest>(`${this.base}/requests/${id}/complete`, {
      internalNote,
      rowVersion,
    });
  }

  cancel(id: string, note: string | null, rowVersion: string): Observable<FormRequest> {
    return this.http.post<FormRequest>(`${this.base}/requests/${id}/cancel`, { note, rowVersion });
  }

  archive(id: string, note: string | null, rowVersion: string): Observable<FormRequest> {
    return this.http.post<FormRequest>(`${this.base}/requests/${id}/archive`, { note, rowVersion });
  }

  changeDueDate(id: string, dueAtUtc: string | null, rowVersion: string): Observable<FormRequest> {
    return this.http.put<FormRequest>(`${this.base}/requests/${id}/due-date`, {
      dueAtUtc,
      rowVersion,
    });
  }

  linkCustomer(id: string, customerId: string, rowVersion: string): Observable<FormRequest> {
    return this.http.post<FormRequest>(`${this.base}/requests/${id}/link-customer`, {
      customerId,
      rowVersion,
    });
  }

  assignResponsible(id: string, userId: string, rowVersion: string): Observable<FormRequest> {
    return this.http.put<FormRequest>(`${this.base}/requests/${id}/responsible`, {
      userId,
      rowVersion,
    });
  }

  reveal(id: string, sensitiveAnswerId: string): Observable<{ value: string; kind: string }> {
    return this.http.post<{ value: string; kind: string }>(
      `${this.base}/requests/${id}/sensitive-answers/${sensitiveAnswerId}/reveal`,
      {},
    );
  }

  startCustomerCreation(id: string): Observable<FormActionRun> {
    return this.http.post<FormActionRun>(`${this.base}/requests/${id}/actions/create-customer`, {});
  }

  retryAction(id: string, runId: string): Observable<FormActionRun> {
    return this.http.post<FormActionRun>(`${this.base}/requests/${id}/actions/${runId}/retry`, {});
  }

  retryCustomerLink(id: string): Observable<FormRequest> {
    return this.http.post<FormRequest>(`${this.base}/requests/${id}/customer-link/retry`, {});
  }

  assignableTemplates(search = ''): Observable<AssignableFormTemplate[]> {
    const params = search ? new HttpParams().set('search', search) : undefined;
    return this.http.get<AssignableFormTemplate[]>(`${this.base}/templates/assignable`, { params });
  }

  /** Todo el staff activo: se piden todas las páginas para no truncar oficinas grandes. */
  activeStaff(): Observable<StaffMemberOption[]> {
    return this.staffPage(1).pipe(
      switchMap((first) => {
        const pages = Math.min(
          STAFF_MAX_PAGES,
          Math.ceil((first.totalCount ?? 0) / STAFF_PAGE_SIZE),
        );
        if (pages <= 1) return of([first]);
        return forkJoin([
          of(first),
          ...Array.from({ length: pages - 1 }, (_, index) => this.staffPage(index + 2)),
        ]);
      }),
      map((pages) =>
        pages
          .flatMap((page) => page.items ?? [])
          .filter((user) => user.isActive)
          .map((user) => ({
            userId: user.id,
            name: `${user.name ?? ''} ${user.lastName ?? ''}`.trim() || user.email,
            email: user.email,
            isActive: user.isActive,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    );
  }

  private staffPage(page: number): Observable<AuthUserPage> {
    const params = new HttpParams()
      .set('accountKind', 'Staff')
      .set('isActive', true)
      .set('page', page)
      .set('size', STAFF_PAGE_SIZE);
    return this.http.get<AuthUserPage>(this.api.tenantUrl('/auth/users'), { params });
  }
}
