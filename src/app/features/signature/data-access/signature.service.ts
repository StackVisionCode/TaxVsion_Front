import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, switchMap } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { InitiateUploadRequest } from '@core/cloud-storage/cloud-storage.model';
import {
  AddSignerBody,
  CreateSignatureRequestBody,
  ListSignatureRequestsParams,
  PlaceFieldBody,
  SignatureAnalyticsSummary,
  SignatureCustomersPage,
  SignatureFieldResponse,
  SignatureRequestDetail,
  SignatureRequestListResult,
  SignatureTemplateDetail,
  SignatureTemplateStatus,
  SignerResponse,
  SetPreparerBody,
  InstantiateTemplateBody,
  TemplateListResult,
  ValidateDocumentResponse,
} from './signature.model';

/**
 * Cliente HTTP fino sobre TaxVision.Signature.Api (`/signature` vía Gateway, mismo
 * patrón que clients.service). Incluye además:
 * - `searchCustomers`: subset de GET /customers para los pickers del wizard (espejo
 *   local, sin import cruzado de features).
 * - `uploadOriginalDocument`: cadena presigned de CloudStorage (initiate → MinIO →
 *   complete) con `ownerType: 'Signature'` + `folderType: 'Signatures'` — los mismos
 *   valores que usa el propio backend de Signature al subir sealed/certificate.
 *   `Signatures` exige `taxYear` (FolderTypeRules.RequiresYear).
 */
@Injectable({ providedIn: 'root' })
export class SignatureService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly cloudStorage = inject(CloudStorageUploadService);

  private get base(): string {
    return this.api.tenantUrl('/signature');
  }

  // ---------- Preflight del documento ----------

  /** POST /signature/documents/validate — multipart, campo `file` (máx 25MB, solo PDF pasa). */
  validateDocument(file: File): Observable<ValidateDocumentResponse> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http.post<ValidateDocumentResponse>(`${this.base}/documents/validate`, body);
  }

  /**
   * Sube el PDF original a CloudStorage y devuelve el `fileId` confirmado.
   * `ownerId` = validationRecordId del preflight (la solicitud aún no existe).
   */
  uploadOriginalDocument(file: File, validationRecordId: string): Observable<string> {
    const request: InitiateUploadRequest = {
      originalName: file.name,
      contentType: file.type || 'application/pdf',
      sizeBytes: file.size,
      ownerType: 'Signature',
      ownerId: validationRecordId,
      folderType: 'Signatures',
      taxYear: new Date().getFullYear(),
    };
    return this.cloudStorage.initiateUpload(request).pipe(
      switchMap(initiated =>
        this.cloudStorage.uploadToPresignedUrl(initiated.uploadUrl, initiated.formData, file).pipe(
          switchMap(() => this.cloudStorage.completeUpload(initiated.fileId)),
          map(() => initiated.fileId),
        ),
      ),
    );
  }

  /** POST /storage/files/{fileId}/download-url — para sealed/certificate/original. */
  getDownloadUrl(fileId: string): Observable<string> {
    return this.cloudStorage.getDownloadUrl(fileId).pipe(map(res => res.downloadUrl));
  }

  // ---------- Ciclo de vida de la solicitud ----------

  create(body: CreateSignatureRequestBody): Observable<SignatureRequestDetail> {
    return this.http.post<SignatureRequestDetail>(`${this.base}/requests`, body);
  }

  list(params: ListSignatureRequestsParams): Observable<SignatureRequestListResult> {
    let query = new HttpParams();
    if (params.status) {
      query = query.set('status', params.status);
    }
    if (params.category) {
      query = query.set('category', params.category);
    }
    if (params.page) {
      query = query.set('page', params.page);
    }
    if (params.size) {
      query = query.set('size', params.size);
    }
    return this.http.get<SignatureRequestListResult>(`${this.base}/requests`, { params: query });
  }

  getById(id: string): Observable<SignatureRequestDetail> {
    return this.http.get<SignatureRequestDetail>(`${this.base}/requests/${id}`);
  }

  addSigner(requestId: string, body: AddSignerBody): Observable<SignerResponse> {
    return this.http.post<SignerResponse>(`${this.base}/requests/${requestId}/signers`, body);
  }

  removeSigner(requestId: string, signerId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/requests/${requestId}/signers/${signerId}`);
  }

  reorderSigners(requestId: string, orderedSignerIds: string[]): Observable<void> {
    return this.http.put<void>(`${this.base}/requests/${requestId}/signers/order`, { orderedSignerIds });
  }

  placeField(requestId: string, body: PlaceFieldBody): Observable<SignatureFieldResponse> {
    return this.http.post<SignatureFieldResponse>(`${this.base}/requests/${requestId}/fields`, body);
  }

  removeField(requestId: string, signerId: string, fieldId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/requests/${requestId}/signers/${signerId}/fields/${fieldId}`);
  }

  /** POST /signature/requests/{id}/send → 202; requiere estado Ready (archivo ya Available). */
  send(requestId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/requests/${requestId}/send`, {});
  }

  cancel(requestId: string, reason: string | null): Observable<void> {
    return this.http.post<void>(`${this.base}/requests/${requestId}/cancel`, { reason });
  }

  /** 1..720 horas adicionales sobre la expiración actual. */
  extendExpiration(requestId: string, additionalHours: number): Observable<void> {
    return this.http.post<void>(`${this.base}/requests/${requestId}/extend-expiration`, { additionalHours });
  }

  /**
   * Fija el PIN del preparador (4–10 dígitos) para verificar al firmante.
   *
   * Es **PUT**, no POST — verificado contra `SignatureRequestsController`; la
   * guía de integración lo documenta como POST y eso daría 405.
   *
   * Sin esto la verificación de identidad no existe en la práctica: el dominio
   * solo bloquea la firma con `RequiresPractitionerPin && !signer.IsPinVerified`,
   * y ese flag es `PractitionerPinHash is not null`, así que mientras nadie fije
   * el PIN el paso de verificación del firmante nunca aparece.
   */
  setPractitionerPin(requestId: string, pin: string): Observable<void> {
    return this.http.put<void>(`${this.base}/requests/${requestId}/practitioner-pin`, { pin });
  }

  /** Quita el PIN: la solicitud vuelve a no exigir verificación por PIN. */
  clearPractitionerPin(requestId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/requests/${requestId}/practitioner-pin`);
  }

  /**
   * Identidad del preparador en la solicitud (Form 8879 §V): PTIN/EFIN, nombre
   * y título. Es **PUT** sobre `/preparer`.
   *
   * ⚠️ `SignatureRequestResponse` NO devuelve el preparador ni
   * `IsPreparerSigned`, así que estas tres son escrituras a ciegas: el front no
   * puede mostrar si ya está fijado o si ya firmó. Queda reflejado en el PDF
   * sellado y en la cadena de auditoría, no en el detalle.
   */
  setPreparer(requestId: string, body: SetPreparerBody): Observable<void> {
    return this.http.put<void>(`${this.base}/requests/${requestId}/preparer`, body);
  }

  clearPreparer(requestId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/requests/${requestId}/preparer`);
  }

  /**
   * Firma interna del preparador. La ruta real es `/preparer/sign` y va **sin
   * body** (el usuario sale del JWT) — la guía la documenta como
   * `/sign-as-preparer`, que no existe.
   */
  signAsPreparer(requestId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/requests/${requestId}/preparer/sign`, {});
  }

  // ---------- Plantillas ----------

  /**
   * Moldes reutilizables de solicitud.
   *
   * ⚠️ Exige el permiso `signature.template.create`, que el rol Employee por
   * defecto NO tiene: para un empleado esto responde 403, no una lista vacía.
   */
  listTemplates(status?: SignatureTemplateStatus, page = 1, size = 50): Observable<TemplateListResult> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (status) {
      params = params.set('status', status);
    }
    return this.http.get<TemplateListResult>(`${this.base}/templates`, { params });
  }

  /** El molde completo: hace falta para saber qué roles (slots) hay que atar. */
  getTemplate(templateId: string): Observable<SignatureTemplateDetail> {
    return this.http.get<SignatureTemplateDetail>(`${this.base}/templates/${templateId}`);
  }

  /**
   * Crea una solicitud a partir del molde → 201 con el mismo
   * `SignatureRequestDetail` que `create`, así que el flujo sigue igual desde
   * ahí (esperar Ready y enviar).
   */
  instantiateTemplate(templateId: string, body: InstantiateTemplateBody): Observable<SignatureRequestDetail> {
    return this.http.post<SignatureRequestDetail>(`${this.base}/templates/${templateId}/instantiate`, body);
  }

  resendSignerInvitation(requestId: string, signerId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/requests/${requestId}/signers/${signerId}/resend`, {});
  }

  // ---------- Métricas ----------

  /** GET /signature/analytics/summary?from=&to= (DateOnly => yyyy-MM-dd). */
  analyticsSummary(fromDay: string, toDay: string): Observable<SignatureAnalyticsSummary> {
    const query = new HttpParams().set('from', fromDay).set('to', toDay);
    return this.http.get<SignatureAnalyticsSummary>(`${this.base}/analytics/summary`, { params: query });
  }

  // ---------- Customers (picker del wizard) ----------

  /** GET /customers — subset espejo de Customer.Api para no importar entre features. */
  searchCustomers(term?: string, size = 200): Observable<SignatureCustomersPage> {
    let query = new HttpParams().set('status', 'NotArchived').set('size', size);
    if (term) {
      query = query.set('term', term);
    }
    return this.http.get<SignatureCustomersPage>(this.api.tenantUrl('/customers'), { params: query });
  }
}
