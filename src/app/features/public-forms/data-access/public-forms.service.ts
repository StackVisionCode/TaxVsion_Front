import { HttpBackend, HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';
import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type {
  DataCollectionFileSelection,
  DataCollectionSensitiveEntry,
} from '@shared/ui/data-collection/data-collection.models';
import type {
  AttachmentUploadResponse,
  DraftSaveResponse,
  PublicDirectedFormAccess,
  PublicFormChallengeResponse,
  PublicFormKind,
  PublicFormLanguage,
  PublicFormRequest,
  PublicFormSessionGrant,
  PublicIntakeFormAccess,
  RowVersionResponse,
  SensitiveAnswerResponse,
  SubmitResponse,
} from './public-forms.model';

@Injectable({ providedIn: 'root' })
export class PublicFormsService {
  private readonly api = inject(ApiConfigService);
  private readonly http = new HttpClient(inject(HttpBackend));

  getAccess(kind: 'directed', token: string) {
    return this.http.get<PublicDirectedFormAccess>(this.accessUrl(kind, token));
  }

  getIntakeAccess(token: string) {
    return this.http.get<PublicIntakeFormAccess>(this.accessUrl('intake', token));
  }

  // P-21.5: el idioma de los avisos al externo viaja en el challenge de captación y en ambos verify.
  requestChallenge(
    kind: PublicFormKind,
    token: string,
    email?: string,
    captchaToken?: string,
    language: PublicFormLanguage = 'En',
  ) {
    const body = kind === 'intake' ? { email, captchaToken, language } : {};
    return this.http.post<PublicFormChallengeResponse | null>(
      `${this.accessUrl(kind, token)}/challenge`,
      body,
    );
  }

  verify(
    kind: PublicFormKind,
    token: string,
    code: string,
    email?: string,
    language: PublicFormLanguage = 'En',
  ) {
    const body = kind === 'intake' ? { email, code, language } : { code, language };
    return this.http.post<PublicFormSessionGrant>(`${this.accessUrl(kind, token)}/verify`, body);
  }

  getRequest(sessionToken: string) {
    return this.http.get<PublicFormRequest>(this.sessionUrl('/request'), {
      headers: this.sessionHeaders(sessionToken),
    });
  }

  saveDraft(sessionToken: string, answers: FormAnswers, rowVersion: string) {
    return this.http.put<DraftSaveResponse>(
      this.sessionUrl('/draft'),
      { answers, rowVersion },
      { headers: this.sessionHeaders(sessionToken) },
    );
  }

  saveDraftKeepalive(sessionToken: string, answers: FormAnswers, rowVersion: string): void {
    void fetch(this.sessionUrl('/draft'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Form-Session': sessionToken,
      },
      body: JSON.stringify({ answers, rowVersion }),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  }

  acceptConsent(sessionToken: string, componentId: string) {
    return this.http.post(
      this.sessionUrl('/consents'),
      { componentId },
      { headers: this.sessionHeaders(sessionToken) },
    );
  }

  declineConsent(sessionToken: string, componentId: string) {
    return this.http.post(
      this.sessionUrl('/consents/decline'),
      { componentId },
      { headers: this.sessionHeaders(sessionToken) },
    );
  }

  captureSensitive(sessionToken: string, entry: DataCollectionSensitiveEntry) {
    return this.http.post<SensitiveAnswerResponse>(
      this.sessionUrl('/sensitive-answers'),
      {
        componentId: entry.componentId,
        rowId: entry.rowId,
        kind: capitalize(entry.kind),
        value: entry.value,
      },
      { headers: this.sessionHeaders(sessionToken) },
    );
  }

  initiateAttachment(sessionToken: string, selection: DataCollectionFileSelection, file: File) {
    return this.http.post<AttachmentUploadResponse>(
      this.sessionUrl('/attachments/uploads'),
      {
        componentId: selection.componentId,
        rowId: selection.rowId,
        originalName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      },
      { headers: this.sessionHeaders(sessionToken) },
    );
  }

  uploadToStorage(upload: AttachmentUploadResponse, file: File) {
    const body = new FormData();
    Object.entries(upload.presignedPost.formData).forEach(([key, value]) =>
      body.append(key, value),
    );
    body.append('file', file);
    return this.http.post(upload.presignedPost.url, body, { responseType: 'text' });
  }

  completeAttachment(sessionToken: string, fileId: string) {
    return this.http.post(
      this.sessionUrl(`/attachments/${encodeURIComponent(fileId)}/complete`),
      {},
      { headers: this.sessionHeaders(sessionToken) },
    );
  }

  removeAttachment(sessionToken: string, attachmentId: string) {
    return this.http.delete<RowVersionResponse>(
      this.sessionUrl(`/attachments/${encodeURIComponent(attachmentId)}`),
      { headers: this.sessionHeaders(sessionToken) },
    );
  }

  submit(sessionToken: string, rowVersion: string) {
    return this.http.post<SubmitResponse>(
      this.sessionUrl('/submit'),
      { rowVersion },
      { headers: this.sessionHeaders(sessionToken) },
    );
  }

  logout(sessionToken: string) {
    return this.http.post<void>(
      this.sessionUrl('/logout'),
      {},
      { headers: this.sessionHeaders(sessionToken) },
    );
  }

  private accessUrl(kind: PublicFormKind, token: string): string {
    const segment = kind === 'directed' ? 'access' : 'intake';
    return this.api.tenantUrl(`/tasks/public/forms/${segment}/${encodeURIComponent(token)}`);
  }

  private sessionUrl(path: string): string {
    return this.api.tenantUrl(`/tasks/public/forms/session${path}`);
  }

  private sessionHeaders(token: string): HttpHeaders {
    return new HttpHeaders({ 'X-Form-Session': token });
  }
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}`;
}
