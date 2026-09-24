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
  PreparerFieldResponse,
  SignatureAnalyticsSummary,
  SignatureFieldKind,
  SignatureFieldResponse,
  SignatureRequestDetail,
  SignatureRequestListResult,
  SignatureTemplateDetail,
  SignatureTemplateStatus,
  SignerResponse,
  SetPreparerBody,
  AddTemplateSlotBody,
  CreateTemplateBody,
  InstantiateTemplateBody,
  PlaceTemplateFieldBody,
  TemplateFieldCreatedResponse,
  TemplateListResult,
  TemplateSlotCreatedResponse,
  SignatureCategoriesResult,
  SignatureCategoryOption,
  SignatureProfile,
  SignatureProfileScope,
  SignatureProfilesResult,
  SignatureSettings,
  UpdateSignatureRequestBody,
  UpdateTemplateDefaultsBody,
  UpdateTemplateMetadataBody,
  ValidateDocumentResponse,
} from './signature.model';

/**
 * Cliente HTTP fino sobre TaxVision.Signature.Api (`/signature` vía Gateway, mismo
 * patrón que clients.service). Incluye además:
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
    if (params.editableOnly) {
      query = query.set('editableOnly', true);
    }
    return this.http.get<SignatureRequestListResult>(`${this.base}/requests`, { params: query });
  }

  getById(id: string): Observable<SignatureRequestDetail> {
    return this.http.get<SignatureRequestDetail>(`${this.base}/requests/${id}`);
  }

  /** PUT /signature/requests/{id} — edita la metadata de un borrador (Draft/Ready). */
  update(id: string, body: UpdateSignatureRequestBody): Observable<void> {
    return this.http.put<void>(`${this.base}/requests/${id}`, body);
  }

  /** DELETE /signature/requests/{id} — borra en firme un borrador sin enviar. */
  deleteRequest(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/requests/${id}`);
  }

  // ---------- Categorías del tenant (14.5) ----------

  /** GET /signature/categories — categorías de sistema + custom del tenant. */
  listCategories(includeArchived = false): Observable<SignatureCategoriesResult> {
    const params = includeArchived ? new HttpParams().set('includeArchived', true) : undefined;
    return this.http.get<SignatureCategoriesResult>(`${this.base}/categories`, { params });
  }

  /** POST /signature/categories — crea una categoría custom. */
  createCategory(name: string): Observable<SignatureCategoryOption> {
    return this.http.post<SignatureCategoryOption>(`${this.base}/categories`, { name });
  }

  /** PUT /signature/categories/{id} — renombra una categoría custom (no toca el histórico, que guarda el nombre congelado). */
  renameCategory(id: string, name: string): Observable<void> {
    return this.http.put<void>(`${this.base}/categories/${id}`, { name });
  }

  /** POST /signature/categories/{id}/archive — la saca del picker sin borrar nada. */
  archiveCategory(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/categories/${id}/archive`, {});
  }

  /** POST /signature/categories/{id}/unarchive — la vuelve a mostrar en el picker. */
  unarchiveCategory(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/categories/${id}/unarchive`, {});
  }

  // ---------- Firmas reutilizables del preparador/oficina (My Signature) ----------

  /** GET /signature/profiles — firmas visibles (propias + oficina). */
  listSignatureProfiles(includeArchived = false): Observable<SignatureProfilesResult> {
    const params = includeArchived ? new HttpParams().set('includeArchived', true) : undefined;
    return this.http.get<SignatureProfilesResult>(`${this.base}/profiles`, { params });
  }

  /** GET /signature/profiles/effective — la firma que se estamparía por el usuario actual. */
  getEffectiveSignature(): Observable<SignatureProfile> {
    return this.http.get<SignatureProfile>(`${this.base}/profiles/effective`);
  }

  /** POST /signature/profiles — crea una firma (imagen PNG en base64, sin el prefijo data-url). */
  createSignatureProfile(body: {
    label: string;
    scope: SignatureProfileScope;
    imageBase64: string;
  }): Observable<SignatureProfile> {
    return this.http.post<SignatureProfile>(`${this.base}/profiles`, body);
  }

  /** PUT /signature/profiles/{id} — renombra. */
  renameSignatureProfile(id: string, label: string): Observable<void> {
    return this.http.put<void>(`${this.base}/profiles/${id}`, { label });
  }

  /** POST /signature/profiles/{id}/default — marca como la por defecto de su ámbito. */
  setDefaultSignatureProfile(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/profiles/${id}/default`, {});
  }

  archiveSignatureProfile(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/profiles/${id}/archive`, {});
  }

  unarchiveSignatureProfile(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/profiles/${id}/unarchive`, {});
  }

  deleteSignatureProfile(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/profiles/${id}`);
  }

  // ---------- Configuración del tenant (gobernanza; solo admin) ----------

  /** GET /signature/settings — requiere permiso SettingsManage (admin). */
  getSignatureSettings(): Observable<SignatureSettings> {
    return this.http.get<SignatureSettings>(`${this.base}/settings`);
  }

  /** PUT /signature/settings — reemplaza toda la configuración (semántica PUT del backend). */
  updateSignatureSettings(body: {
    allowedVerificationChannels: string[];
    defaultVerificationChannel: string;
    defaultTokenExpirationHours: number;
    remindersEnabledByDefault: boolean;
    generateCertificateByDefault: boolean;
    documentLimits: { maxPdfBytes: number; maxImageBytes: number; maxPagesPerDocument: number };
    retentionPolicy: { retentionYears: number; allowPurge: boolean };
    defaultReminderIntervalHours: number;
    allowEmployeeOwnSignature: boolean;
  }): Observable<void> {
    return this.http.put<void>(`${this.base}/settings`, body);
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

  // ---------- Campos del preparador (canal paralelo, Form 8879) ----------

  /** POST /signature/requests/{id}/preparer-fields — coloca un campo del preparador. */
  placePreparerField(
    requestId: string,
    body: { kind: SignatureFieldKind; page: number; x: number; y: number; width: number; height: number; label: string | null },
  ): Observable<PreparerFieldResponse> {
    return this.http.post<PreparerFieldResponse>(`${this.base}/requests/${requestId}/preparer-fields`, body);
  }

  removePreparerField(requestId: string, fieldId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/requests/${requestId}/preparer-fields/${fieldId}`);
  }

  /** PUT /signature/requests/{id}/preparer-signature — congela qué firma se estampará (null = la efectiva). */
  setPreparerSignature(requestId: string, signatureFileId: string | null): Observable<void> {
    return this.http.put<void>(`${this.base}/requests/${requestId}/preparer-signature`, { signatureFileId });
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

  // ---------- Autoría de plantillas (staff con permiso template.create/update) ----------

  /** POST /signature/templates — nace en Draft. Devuelve el molde completo. */
  createTemplate(body: CreateTemplateBody): Observable<SignatureTemplateDetail> {
    return this.http.post<SignatureTemplateDetail>(`${this.base}/templates`, body);
  }

  /** PUT /signature/templates/{id}/metadata → 204. */
  updateTemplateMetadata(templateId: string, body: UpdateTemplateMetadataBody): Observable<void> {
    return this.http.put<void>(`${this.base}/templates/${templateId}/metadata`, body);
  }

  /** PUT /signature/templates/{id}/defaults → 204. */
  updateTemplateDefaults(templateId: string, body: UpdateTemplateDefaultsBody): Observable<void> {
    return this.http.put<void>(`${this.base}/templates/${templateId}/defaults`, body);
  }

  /** Practitioner PIN por defecto de la plantilla (Form 8879); las requests desde la plantilla lo heredan. */
  setTemplatePractitionerPin(templateId: string, pin: string): Observable<void> {
    return this.http.put<void>(`${this.base}/templates/${templateId}/practitioner-pin`, { pin });
  }

  clearTemplatePractitionerPin(templateId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/templates/${templateId}/practitioner-pin`);
  }

  /** PUT /signature/templates/{id}/base-document → 204. P7: fija (o quita con null) el documento base. */
  setTemplateBaseDocument(templateId: string, baseDocumentFileId: string | null): Observable<void> {
    return this.http.put<void>(`${this.base}/templates/${templateId}/base-document`, { baseDocumentFileId });
  }

  /** POST /signature/templates/{id}/slots → 201 con el `order` asignado. */
  addTemplateSlot(templateId: string, body: AddTemplateSlotBody): Observable<TemplateSlotCreatedResponse> {
    return this.http.post<TemplateSlotCreatedResponse>(`${this.base}/templates/${templateId}/slots`, body);
  }

  /** PUT /signature/templates/{id}/slots/{slotOrder} → 204. Edita rol/idioma/OTP en sitio (solo Draft). */
  updateTemplateSlot(templateId: string, slotOrder: number, body: AddTemplateSlotBody): Observable<void> {
    return this.http.put<void>(`${this.base}/templates/${templateId}/slots/${slotOrder}`, body);
  }

  /** DELETE /signature/templates/{id}/slots/{slotOrder} → 204. Borra también sus campos. */
  removeTemplateSlot(templateId: string, slotOrder: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/templates/${templateId}/slots/${slotOrder}`);
  }

  /** POST /signature/templates/{id}/revert-to-draft → 204. Published → Draft para poder editar. */
  revertTemplateToDraft(templateId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/templates/${templateId}/revert-to-draft`, {});
  }

  /** POST /signature/templates/{id}/fields → 201. Coordenadas normalizadas [0..1]. */
  placeTemplateField(templateId: string, body: PlaceTemplateFieldBody): Observable<TemplateFieldCreatedResponse> {
    return this.http.post<TemplateFieldCreatedResponse>(`${this.base}/templates/${templateId}/fields`, body);
  }

  /** DELETE /signature/templates/{id}/fields/{fieldId} → 204. */
  removeTemplateField(templateId: string, fieldId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/templates/${templateId}/fields/${fieldId}`);
  }

  /** POST /signature/templates/{id}/preparer-fields — predefine el campo de firma del preparador (14.5 F7). */
  placeTemplatePreparerField(
    templateId: string,
    body: { kind: SignatureFieldKind; page: number; x: number; y: number; width: number; height: number; label: string | null },
  ): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/templates/${templateId}/preparer-fields`, body);
  }

  removeTemplatePreparerField(templateId: string, fieldId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/templates/${templateId}/preparer-fields/${fieldId}`);
  }

  /** POST /signature/templates/{id}/publish → 204. Exige ≥1 slot y ≥1 campo Signature/Initials. */
  publishTemplate(templateId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/templates/${templateId}/publish`, {});
  }

  /** POST /signature/templates/{id}/archive → 204. */
  archiveTemplate(templateId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/templates/${templateId}/archive`, {});
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

}
