import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, debounceTime, firstValueFrom, forkJoin, map, of, switchMap, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { SignatureRequest } from '../ui/signature-table/signature-table.component';
import { WizardClient } from '../ui/signature-request-panel/signature-wizard.model';
import { SignatureService } from './signature.service';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { SignatureRealtimeService } from './signature-realtime.service';
import {
  ApiSignatureRequestStatus,
  SignatureCategory,
  SignatureFieldKind,
  SignerLanguage,
  SignerVerificationMethod,
  PreparerSessionState,
  SetPreparerBody,
  SignatureCategoryOption,
  SignatureRequestDetail,
  SignatureTemplateDetail,
  SlotBinding,
  TemplateSummary,
  UpdateSignatureRequestBody,
  ValidateDocumentResponse,
  customerToWizardClient,
  detailToUiRequest,
} from './signature.model';

/** Tamaño de página del listado (server-side, igual que el PAGE_SIZE previo de la UI). */
export const SIGNATURE_PAGE_SIZE = 8;

/** Reintentos de espera Draft→Ready antes de rendirse (el scan de CloudStorage es asíncrono). */
const READY_POLL_MAX_ATTEMPTS = 10;
const READY_POLL_INTERVAL_MS = 2000;

// 'Drafts' = borradores editables (Draft+Ready) vía editableOnly; el resto mapea 1:1 al status del backend.
export type SignatureStatusFilter = 'All' | 'Drafts' | ApiSignatureRequestStatus;

// ---------- Draft del wizard (lo que el panel arma al enviar) ----------

export interface WizardSignerDraft {
  /** id local del editor (`client:<id>` / `signer-N`), clave del mapeo local→backend. */
  localId: string;
  fullName: string;
  email: string;
  /** Idioma de los correos al firmante ('Es' | 'En'). */
  language: SignerLanguage;
  /** Teléfono para OTP por SMS/WhatsApp; null si no aplica. */
  phone: string | null;
  /** OTP requerido antes de firmar (derivado del canal); undefined = sin OTP. */
  verificationMethod?: SignerVerificationMethod;
}

/** Campo ya en coordenadas normalizadas [0..1], origen arriba-izquierda (convención FieldPosition del backend). */
export interface WizardFieldDraft {
  localId: string;
  signerLocalId: string;
  kind: SignatureFieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isRequired: boolean;
  /** Etiqueta/instrucción del campo de texto (P4); null en los demás tipos. */
  label: string | null;
}

export interface WizardRequestDraft {
  title: string;
  description: string | null;
  category: SignatureCategory;
  originalFileId: string;
  tokenExpirationHours: number;
  requiresSequentialSigning: boolean;
  requiresConsent: boolean;
  generateCertificate: boolean;
  /** P2: entregar el documento firmado / el certificado a los firmantes (gateado por permiso en backend). */
  sendSignedDocumentToSigners: boolean;
  sendCertificateToSigners: boolean;
  /** Recordatorios automáticos a firmantes: on/off + intervalo (horas). */
  autoRemindersEnabled: boolean;
  reminderIntervalHours: number;
  /**
   * PIN del preparador (Form 8879), 4–10 dígitos, opcional (null = sin PIN). Se fija ENTRE crear y
   * enviar (mientras Draft/Ready), vía PUT practitioner-pin — el backend lo hashea.
   */
  signingPin: string | null;
  /** En orden de firma (el backend asigna `order` por inserción). */
  signers: WizardSignerDraft[];
  fields: WizardFieldDraft[];
}

/**
 * Progreso del envío multi-paso (create → signers → fields → ready-wait → send).
 * Se conserva entre reintentos: si algo falla a mitad, la solicitud queda en
 * Draft/Ready en el backend y el retry retoma exactamente donde quedó.
 */
export interface WizardSendState {
  requestId: string | null;
  signerIdByLocal: Record<string, string>;
  postedFieldLocalIds: string[];
  /** Ya se fijó el practitioner PIN (si el draft lo pedía) — evita re-fijarlo en un reintento. */
  pinSet: boolean;
  sent: boolean;
}

export function emptySendState(): WizardSendState {
  return { requestId: null, signerIdByLocal: {}, postedFieldLocalIds: [], pinSet: false, sent: false };
}

export type WizardSendPhase = 'creating' | 'sending';

/** Ids originales (del backend) de un borrador rehidratado, para calcular qué borrar al editar. */
export interface DraftEditOriginal {
  signerBackendIds: string[];
  fields: { editorLocalId: string; fieldId: string; signerBackendId: string }[];
}

export interface DraftEditPlan {
  removeSignerBackendIds: string[];
  removeFields: { signerBackendId: string; fieldId: string }[];
}

/**
 * Diff puro: qué firmantes/campos del borrador original ya no están en la edición actual y hay que
 * borrar. Un firmante presente = su localId sigue mapeado a un id de backend en el `state`; un campo
 * cuyo firmante sobrevive pero cuyo localId desapareció se borra (si el firmante se borró, el backend
 * borra sus campos en cascada, así que no se listan aquí).
 */
export function computeDraftEditPlan(
  draft: WizardRequestDraft,
  state: WizardSendState,
  original: DraftEditOriginal,
): DraftEditPlan {
  const currentBackendIds = draft.signers
    .map(signer => state.signerIdByLocal[signer.localId])
    .filter((id): id is string => !!id);
  const currentFieldLocalIds = new Set(draft.fields.map(field => field.localId));

  return {
    removeSignerBackendIds: original.signerBackendIds.filter(id => !currentBackendIds.includes(id)),
    removeFields: original.fields
      .filter(
        field => currentBackendIds.includes(field.signerBackendId) && !currentFieldLocalIds.has(field.editorLocalId),
      )
      .map(field => ({ signerBackendId: field.signerBackendId, fieldId: field.fieldId })),
  };
}

export interface SignatureStats {
  totalRequests: number;
  inProgress: number;
  completedThisMonth: number;
  /** 0..1 (analytics summary del mes en curso). */
  completionRate: number;
}

/**
 * Store del módulo Signature (staff): listado paginado en servidor + filtro de
 * estado server-side, detalle hidratado por fila (el summary no trae firmantes y la
 * tabla los muestra), stats, picker de customers y orquestación del wizard.
 * providedIn: 'root', mismo patrón que clients/documents.
 */
@Injectable({ providedIn: 'root' })
export class SignatureStore {
  private readonly service = inject(SignatureService);
  private readonly directory = inject(CustomerDirectoryStore);
  private readonly realtime = inject(SignatureRealtimeService);

  constructor() {
    // Realtime: cuando alguien firma/rechaza o cambia el estado, Communication emite
    // `signature.request.changed` por-tenant. Refrescamos la lista (debounced para coalescer ráfagas
    // de varios firmantes) SOLO si ya se cargó alguna vez — si el usuario nunca abrió firmas, no
    // hay nada que refrescar y al abrirla se carga igual.
    this.realtime.connect();
    this.realtime.requestChanged$
      .pipe(debounceTime(400), takeUntilDestroyed())
      .subscribe(() => {
        if (this.refreshToken > 0) {
          this.refresh();
          this.loadStats();
        }
      });
  }

  // ---------- Listado ----------
  private readonly _requests = signal<SignatureRequest[]>([]);
  private readonly _totalCount = signal(0);
  private readonly _page = signal(1);
  private readonly _statusFilter = signal<SignatureStatusFilter>('All');
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly requests = this._requests.asReadonly();
  readonly totalCount = this._totalCount.asReadonly();
  readonly page = this._page.asReadonly();
  readonly statusFilter = this._statusFilter.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly pageSize = SIGNATURE_PAGE_SIZE;

  private refreshToken = 0;

  // ---------- Stats ----------
  private readonly _stats = signal<SignatureStats | null>(null);
  private readonly _statsLoading = signal(false);
  readonly stats = this._stats.asReadonly();
  readonly statsLoading = this._statsLoading.asReadonly();

  // ---------- Customers (picker del wizard) ----------
  private readonly _customers = signal<WizardClient[]>([]);
  private readonly _customersLoading = signal(false);
  private readonly _customersError = signal<string | null>(null);
  private customersLoaded = false;
  /** Guarda de orden: descarta respuestas que llegan tarde tras una búsqueda más reciente. */
  private customersReqSeq = 0;

  readonly customers = this._customers.asReadonly();
  readonly customersLoading = this._customersLoading.asReadonly();
  readonly customersError = this._customersError.asReadonly();

  // ==================================================================
  // Listado
  // ==================================================================

  setStatusFilter(filter: SignatureStatusFilter): void {
    this._statusFilter.set(filter);
    this._page.set(1);
    this.refresh();
  }

  setPage(page: number): void {
    this._page.set(page);
    this.refresh();
  }

  /**
   * GET /signature/requests (status + paginación server-side) y luego un GET por
   * detalle: el summary no trae firmantes ni fileIds y la tabla/preview los
   * necesita (columna Client/Signers, descargas, resend por firmante).
   */
  refresh(): void {
    const token = ++this.refreshToken;
    this._loading.set(true);
    this._error.set(null);
    const filter = this._statusFilter();
    this.service
      .list({
        status: filter === 'All' || filter === 'Drafts' ? undefined : filter,
        editableOnly: filter === 'Drafts',
        page: this._page(),
        size: SIGNATURE_PAGE_SIZE,
      })
      .pipe(
        switchMap(result =>
          result.items.length === 0
            ? of({ result, details: [] as SignatureRequestDetail[] })
            : forkJoin(result.items.map(item => this.service.getById(item.id))).pipe(
                map(details => ({ result, details })),
              ),
        ),
      )
      .subscribe({
        next: ({ result, details }) => {
          if (token !== this.refreshToken) {
            return;
          }
          this._requests.set(details.map(detailToUiRequest));
          this._totalCount.set(result.totalCount);
          this._loading.set(false);
        },
        error: err => {
          if (token !== this.refreshToken) {
            return;
          }
          this._error.set(toApiError(err).message);
          this._loading.set(false);
        },
      });
  }

  // ==================================================================
  // Stats (cards de la página)
  // ==================================================================

  loadStats(): void {
    this._statsLoading.set(true);
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const today = now.toISOString().slice(0, 10);
    forkJoin({
      all: this.service.list({ page: 1, size: 1 }),
      inProgress: this.service.list({ status: 'InProgress', page: 1, size: 1 }),
      month: this.service.analyticsSummary(monthStart, today),
    }).subscribe({
      next: ({ all, inProgress, month }) => {
        this._stats.set({
          totalRequests: all.totalCount,
          inProgress: inProgress.totalCount,
          completedThisMonth: month.requestsCompleted,
          completionRate: month.completionRate,
        });
        this._statsLoading.set(false);
      },
      error: () => {
        // Las cards no bloquean la página: se quedan en "—" si analytics falla.
        this._statsLoading.set(false);
      },
    });
  }

  // ==================================================================
  // Acciones por fila
  // ==================================================================

  cancel(requestId: string, reason: string | null): Observable<void> {
    return this.service.cancel(requestId, reason).pipe(tap(() => this.refreshAfterAction()));
  }

  /** Edita la metadata de un borrador (Draft/Ready). */
  updateRequest(requestId: string, body: UpdateSignatureRequestBody): Observable<void> {
    return this.service.update(requestId, body).pipe(tap(() => this.refreshAfterAction()));
  }

  /** Borra en firme un borrador sin enviar. */
  deleteRequest(requestId: string): Observable<void> {
    return this.service.deleteRequest(requestId).pipe(tap(() => this.refreshAfterAction()));
  }

  extendExpiration(requestId: string, additionalHours: number): Observable<void> {
    return this.service.extendExpiration(requestId, additionalHours).pipe(tap(() => this.refreshAfterAction()));
  }

  /**
   * PIN del preparador: lo fija el staff y el firmante lo teclea en su paso de
   * verificación. Se refresca la lista porque el detalle expone
   * `requiresPractitionerPin` / `practitionerPinSetAtUtc` y la UI los muestra.
   */
  setPractitionerPin(requestId: string, pin: string): Observable<void> {
    return this.service.setPractitionerPin(requestId, pin).pipe(tap(() => this.refreshAfterAction()));
  }

  clearPractitionerPin(requestId: string): Observable<void> {
    return this.service.clearPractitionerPin(requestId).pipe(tap(() => this.refreshAfterAction()));
  }

  /**
   * Preparador guardado en ESTA sesión, por solicitud.
   *
   * `SignatureRequestResponse` no devuelve el preparador ni `IsPreparerSigned`,
   * así que sin esto el formulario salía vacío cada vez y no había forma de
   * saber si ya se había guardado algo o firmado. Se conserva la respuesta de
   * la propia escritura —que es lo que quedó en el servidor— para poder
   * precargar y mostrar el estado mientras dure la sesión.
   */
  private readonly _preparers = signal<Record<string, PreparerSessionState>>({});
  readonly preparers = this._preparers.asReadonly();

  preparerFor(requestId: string): PreparerSessionState | null {
    return this._preparers()[requestId] ?? null;
  }

  private patchPreparer(requestId: string, patch: Partial<PreparerSessionState>): void {
    this._preparers.update(all => {
      const current = all[requestId] ?? { info: null, signed: false };
      return { ...all, [requestId]: { ...current, ...patch } };
    });
  }

  setPreparer(requestId: string, body: SetPreparerBody): Observable<void> {
    return this.service.setPreparer(requestId, body).pipe(tap(() => this.patchPreparer(requestId, { info: body })));
  }

  clearPreparer(requestId: string): Observable<void> {
    return this.service
      .clearPreparer(requestId)
      .pipe(tap(() => this.patchPreparer(requestId, { info: null, signed: false })));
  }

  signAsPreparer(requestId: string): Observable<void> {
    return this.service.signAsPreparer(requestId).pipe(tap(() => this.patchPreparer(requestId, { signed: true })));
  }

  // ---------- Plantillas ----------

  readonly templates = signal<TemplateSummary[]>([]);
  readonly templatesLoading = signal(false);
  readonly templatesError = signal<string | null>(null);

  /**
   * Solo las publicadas: un molde en Draft todavía se está armando y sus slots
   * o campos pueden estar incompletos, así que instanciarlo daría una solicitud
   * a medias.
   */
  loadTemplates(): void {
    this.templatesLoading.set(true);
    this.templatesError.set(null);
    this.service.listTemplates('Published').subscribe({
      next: result => {
        this.templates.set(result.items ?? []);
        this.templatesLoading.set(false);
      },
      error: err => {
        this.templatesError.set(toApiError(err).message);
        this.templatesLoading.set(false);
      },
    });
  }

  getTemplate(templateId: string): Observable<SignatureTemplateDetail> {
    return this.service.getTemplate(templateId);
  }

  /**
   * Crea la solicitud desde el molde. El PDF pasa por el mismo preflight y la
   * misma cadena de CloudStorage que el wizard normal — la plantilla aporta el
   * layout de campos y los settings, nunca el documento.
   *
   * Queda en Draft a propósito: el staff revisa y envía desde la lista, igual
   * que una solicitud creada a mano (Draft→Ready sigue dependiendo del scan).
   */
  instantiateTemplate(
    templateId: string,
    file: File,
    slotBindings: SlotBinding[],
    descriptionOverride: string | null,
  ): Observable<SignatureRequestDetail> {
    return this.service.validateDocument(file).pipe(
      switchMap(validation => {
        if (!validation.isAcceptable) {
          // `issues` son objetos {code, message}, no strings (la guía dice string[]).
          throw new Error(validation.issues[0]?.message ?? 'That PDF cannot be used for signing.');
        }
        return this.service.uploadOriginalDocument(file, validation.validationRecordId);
      }),
      switchMap(originalFileId =>
        this.service.instantiateTemplate(templateId, { originalFileId, slotBindings, descriptionOverride }),
      ),
      tap(() => this.refreshAfterAction()),
    );
  }

  /**
   * Igual que {@link instantiateTemplate} pero reusando un PDF ya existente de la oficina
   * (su `originalFileId` de CloudStorage): no valida ni vuelve a subir. El Create promueve
   * Draft→Ready leyendo la proyección local, porque el archivo ya está `Available`.
   */
  instantiateTemplateWithFileId(
    templateId: string,
    originalFileId: string,
    slotBindings: SlotBinding[],
    descriptionOverride: string | null,
  ): Observable<SignatureRequestDetail> {
    return this.service
      .instantiateTemplate(templateId, { originalFileId, slotBindings, descriptionOverride })
      .pipe(tap(() => this.refreshAfterAction()));
  }

  /**
   * Envía una solicitud Ready (Ready → InProgress): dispara las invitaciones a los
   * firmantes. Lo usa el detalle para las solicitudes creadas desde plantilla, que quedan
   * en Ready sin enviarse. El wizard normal ya envía al final de {@link sendWizard}.
   */
  sendRequest(requestId: string): Observable<void> {
    return this.service.send(requestId).pipe(tap(() => this.refreshAfterAction()));
  }

  /** Detalle de una solicitud mapeado al shape de UI (para refrescar el preview tras una acción). */
  getRequestUi(requestId: string): Observable<SignatureRequest> {
    return this.service.getById(requestId).pipe(map(detailToUiRequest));
  }

  /** Detalle crudo del backend (para rehidratar el wizard al continuar un borrador). */
  getDetail(requestId: string): Observable<SignatureRequestDetail> {
    return this.service.getById(requestId);
  }

  // ---------- Categorías del tenant (14.5) ----------
  private readonly _categories = signal<SignatureCategoryOption[]>([]);
  private categoriesLoaded = false;
  readonly categories = this._categories.asReadonly();
  /** Las utilizables en el picker: sistema + custom no archivadas. */
  readonly activeCategories = computed(() => this._categories().filter(c => !c.isArchived));

  loadCategories(force = false): void {
    if (this.categoriesLoaded && !force) {
      return;
    }
    // includeArchived=true: una sola carga sirve al picker (activeCategories filtra) y a la gestión (F4).
    this.service.listCategories(true).subscribe({
      next: result => {
        this._categories.set(result.categories);
        this.categoriesLoaded = true;
      },
      error: () => {
        // Si falla, el picker cae a las de sistema que el propio backend siempre incluye en el próximo intento.
      },
    });
  }

  /** Crea una categoría custom y refresca la lista. */
  createCategory(name: string): Observable<SignatureCategoryOption> {
    return this.service.createCategory(name).pipe(tap(() => this.loadCategories(true)));
  }

  /** Renombra una categoría custom y refresca la lista (gestión, F4). */
  renameCategory(id: string, name: string): Observable<void> {
    return this.service.renameCategory(id, name).pipe(tap(() => this.loadCategories(true)));
  }

  /** Archiva una categoría custom (la saca del picker) y refresca. */
  archiveCategory(id: string): Observable<void> {
    return this.service.archiveCategory(id).pipe(tap(() => this.loadCategories(true)));
  }

  /** Desarchiva una categoría custom (la vuelve al picker) y refresca. */
  unarchiveCategory(id: string): Observable<void> {
    return this.service.unarchiveCategory(id).pipe(tap(() => this.loadCategories(true)));
  }

  /**
   * Instancia desde plantilla (subiendo un archivo o reusando uno de la oficina) y la ENVÍA en
   * cuanto el documento queda Ready — todo en una sola acción, como el wizard normal. Reporta la
   * fase para el loading. Si el archivo sigue en escaneo cuando se agota el poll, la solicitud
   * queda creada (Draft/Ready) y se devuelve `sent: false` para que el usuario la mande con el
   * botón (no se pierde nada). El barrido de reconciliación del backend también la rescata.
   */
  async instantiateTemplateAndSend(
    templateId: string,
    source: { file: File } | { fileId: string } | { templateDoc: true },
    slotBindings: SlotBinding[],
    descriptionOverride: string | null,
    onPhase?: (phase: 'creating' | 'preparing' | 'sending') => void,
  ): Promise<{ detail: SignatureRequestDetail; sent: boolean }> {
    onPhase?.('creating');
    let detail: SignatureRequestDetail;
    if ('templateDoc' in source) {
      // P7: sin documento → el backend reusa el documento base de la plantilla.
      detail = await firstValueFrom(
        this.service.instantiateTemplate(templateId, { slotBindings, descriptionOverride }),
      );
      this.refreshAfterAction();
    } else if ('fileId' in source) {
      detail = await firstValueFrom(
        this.instantiateTemplateWithFileId(templateId, source.fileId, slotBindings, descriptionOverride),
      );
    } else {
      detail = await firstValueFrom(
        this.instantiateTemplate(templateId, source.file, slotBindings, descriptionOverride),
      );
    }

    try {
      onPhase?.('preparing');
      await this.waitUntilReady(detail.id);
      onPhase?.('sending');
      await firstValueFrom(this.service.send(detail.id));
      this.refreshAfterAction();
      return { detail, sent: true };
    } catch (err) {
      // Sigue en scan (SendNotReadyError) o el send falló: la request quedó creada. Se refresca y
      // se deja al usuario el botón de enviar.
      this.refreshAfterAction();
      if (err instanceof SendNotReadyError) {
        return { detail, sent: false };
      }
      throw new Error(toApiError(err).message);
    }
  }

  /** Reset a la primera página + refresh: para mostrar la solicitud recién creada (orden CreatedAt DESC). */
  reloadTop(): void {
    this._page.set(1);
    this.refresh();
  }

  resendSigner(requestId: string, signerId: string): Observable<void> {
    return this.service.resendSignerInvitation(requestId, signerId);
  }

  /** Reenvía la invitación a todos los firmantes aún pendientes de la solicitud. */
  resendAllPending(request: SignatureRequest): Observable<void> {
    const pending = request.signers.filter(s => s.status === 'pending' && s.id);
    if (pending.length === 0) {
      return of(undefined);
    }
    return forkJoin(pending.map(s => this.service.resendSignerInvitation(request.id, s.id!))).pipe(
      map(() => undefined),
    );
  }

  /** URL presignada de descarga (sealed / certificate / original) vía CloudStorage. */
  getDownloadUrl(fileId: string): Observable<string> {
    return this.service.getDownloadUrl(fileId);
  }

  private refreshAfterAction(): void {
    this.refresh();
    this.loadStats();
  }

  // ==================================================================
  // Customers
  // ==================================================================

  loadCustomers(force = false): void {
    if (this.customersLoaded && !force) {
      return;
    }
    this.fetchCustomers();
  }

  /**
   * Búsqueda server-side (typeahead) del picker del wizard. El backend `GET /customers`
   * busca por nombre, email y teléfono sobre TODO el tenant, así que encuentra clientes
   * más allá del lote inicial precargado (antes el filtro era 100% client-side y quedaba
   * topado a los primeros resultados cargados). Con `term` vacío recarga el lote de browse.
   * El componente lo llama con debounce; aquí sólo aplicamos la guarda de orden.
   */
  queryCustomers(term: string): void {
    this.fetchCustomers(term.trim() || undefined);
  }

  private fetchCustomers(term?: string): void {
    const seq = ++this.customersReqSeq;
    this._customersLoading.set(true);
    this._customersError.set(null);
    this.directory.search({ term, status: 'NotArchived', size: 200 }).subscribe({
      next: result => {
        if (seq !== this.customersReqSeq) {
          return; // llegó tarde: una búsqueda posterior ya manda
        }
        this._customers.set(result.items.map(customerToWizardClient));
        this.customersLoaded = true;
        this._customersLoading.set(false);
      },
      error: err => {
        if (seq !== this.customersReqSeq) {
          return;
        }
        this._customersError.set(toApiError(err).message);
        this._customersLoading.set(false);
      },
    });
  }

  // ==================================================================
  // Wizard: preflight + upload + envío multi-paso
  // ==================================================================

  validateDocument(file: File): Observable<ValidateDocumentResponse> {
    return this.service.validateDocument(file);
  }

  uploadOriginalDocument(file: File, validationRecordId: string): Observable<string> {
    return this.service.uploadOriginalDocument(file, validationRecordId);
  }

  /**
   * Ejecuta (o retoma) el envío: create → add signers en orden → place fields →
   * esperar Draft→Ready (promoción asíncrona al quedar el archivo Available) → send.
   * Muta y devuelve `state` para que el caller pueda reintentar sin duplicar nada;
   * lanza Error con mensaje humano si algún paso falla (la solicitud queda en
   * Draft/Ready y el retry continúa desde ahí).
   */
  async sendWizard(
    draft: WizardRequestDraft,
    state: WizardSendState,
    onPhase?: (phase: WizardSendPhase) => void,
  ): Promise<WizardSendState> {
    try {
      await this.materializeDraft(draft, state, onPhase);

      if (!state.sent) {
        onPhase?.('sending');
        await this.waitUntilReady(state.requestId!);
        await firstValueFrom(this.service.send(state.requestId!));
        state.sent = true;
      }

      this.refreshAfterAction();
      return state;
    } catch (err) {
      if (err instanceof SendNotReadyError) {
        throw err;
      }
      throw new Error(toApiError(err).message);
    }
  }

  /**
   * Guarda el borrador SIN enviarlo: create → firmantes → campos → PIN, y para. Reusa el mismo
   * `WizardSendState` (idempotente por reintentos); el backend lo deja en Draft/Ready y el usuario
   * lo envía luego desde la lista. Lanza Error con mensaje humano si algún paso falla.
   */
  async saveDraft(draft: WizardRequestDraft, state: WizardSendState): Promise<WizardSendState> {
    try {
      await this.materializeDraft(draft, state);
      this.refreshAfterAction();
      return state;
    } catch (err) {
      throw new Error(toApiError(err).message);
    }
  }

  /**
   * Guarda/envía un borrador REHIDRATADO (F4b). A diferencia de `sendWizard`, aquí ya existe la
   * solicitud: se edita la metadata (PUT), se borran los firmantes/campos que el usuario quitó, se
   * agregan los nuevos, se reordena y — si `send` — se envía. El `state` sembrado hace que
   * `materializeDraft` no re-cree ni re-agregue lo que ya existía.
   *
   * Limitaciones (sin endpoint en el backend): editar canal/teléfono de un firmante existente o
   * mover un campo ya colocado no se persiste; sí add/remove/reorder de firmantes, add/remove de
   * campos y la metadata.
   */
  async commitEditedDraft(
    draft: WizardRequestDraft,
    state: WizardSendState,
    original: DraftEditOriginal,
    send: boolean,
    onPhase?: (phase: WizardSendPhase) => void,
  ): Promise<WizardSendState> {
    const requestId = state.requestId;
    if (!requestId) {
      throw new Error('The draft to edit no longer exists.');
    }
    try {
      onPhase?.('creating');
      // Metadata + flags de entrega/reminders (para que los toggles editados al continuar se guarden).
      // GenerateCertificate es inmutable tras crear; SetCertificateDelivery solo acepta true si aquél
      // está activo, pero el editor no deja activar "send certificate" sin "generate", así que es coherente.
      await firstValueFrom(
        this.service.update(requestId, {
          title: draft.title,
          description: draft.description,
          category: draft.category,
          tokenExpirationHours: draft.tokenExpirationHours,
          sendSignedDocumentToSigners: draft.sendSignedDocumentToSigners,
          sendCertificateToSigners: draft.sendCertificateToSigners,
          autoRemindersEnabled: draft.autoRemindersEnabled,
          reminderIntervalHours: draft.reminderIntervalHours,
        }),
      );

      // Bajas de lo que el usuario quitó (los campos de un firmante borrado caen en cascada).
      const plan = computeDraftEditPlan(draft, state, original);
      for (const field of plan.removeFields) {
        await firstValueFrom(this.service.removeField(requestId, field.signerBackendId, field.fieldId));
      }
      for (const signerId of plan.removeSignerBackendIds) {
        await firstValueFrom(this.service.removeSigner(requestId, signerId));
      }

      // Altas nuevas (firmantes/campos/PIN); lo existente se omite por el state sembrado.
      await this.materializeDraft(draft, state);

      // Reordena al orden final (idempotente).
      const orderedIds = draft.signers
        .map(signer => state.signerIdByLocal[signer.localId])
        .filter((id): id is string => !!id);
      if (orderedIds.length > 0) {
        await firstValueFrom(this.service.reorderSigners(requestId, orderedIds));
      }

      if (send && !state.sent) {
        onPhase?.('sending');
        await this.waitUntilReady(requestId);
        await firstValueFrom(this.service.send(requestId));
        state.sent = true;
      }

      this.refreshAfterAction();
      return state;
    } catch (err) {
      if (err instanceof SendNotReadyError) {
        throw err;
      }
      throw new Error(toApiError(err).message);
    }
  }

  /** Pasos compartidos por envío y guardar-borrador: create → firmantes → campos → PIN (todo menos send). */
  private async materializeDraft(
    draft: WizardRequestDraft,
    state: WizardSendState,
    onPhase?: (phase: WizardSendPhase) => void,
  ): Promise<void> {
    onPhase?.('creating');
    if (!state.requestId) {
      const created = await firstValueFrom(
        this.service.create({
          title: draft.title,
          description: draft.description,
          category: draft.category,
          originalFileId: draft.originalFileId,
          tokenExpirationHours: draft.tokenExpirationHours,
          requiresSequentialSigning: draft.requiresSequentialSigning,
          requiresConsent: draft.requiresConsent,
          generateCertificate: draft.generateCertificate,
          sendSignedDocumentToSigners: draft.sendSignedDocumentToSigners,
          sendCertificateToSigners: draft.sendCertificateToSigners,
          autoRemindersEnabled: draft.autoRemindersEnabled,
          reminderIntervalHours: draft.reminderIntervalHours,
        }),
      );
      state.requestId = created.id;
    }
    const requestId = state.requestId;

    // Firmantes en orden (el backend asigna `order` por inserción) — secuencial a propósito.
    for (const signer of draft.signers) {
      if (state.signerIdByLocal[signer.localId]) {
        continue;
      }
      const created = await firstValueFrom(
        this.service.addSigner(requestId, {
          email: signer.email,
          fullName: signer.fullName,
          language: signer.language,
          phoneNumber: signer.phone,
          verificationMethod: signer.verificationMethod,
        }),
      );
      state.signerIdByLocal[signer.localId] = created.id;
    }

    // Campos (coordenadas ya normalizadas [0..1], origen arriba-izquierda).
    for (const field of draft.fields) {
      if (state.postedFieldLocalIds.includes(field.localId)) {
        continue;
      }
      const signerId = state.signerIdByLocal[field.signerLocalId];
      if (!signerId) {
        continue; // firmante eliminado entre reintentos: campo huérfano, se omite
      }
      await firstValueFrom(
        this.service.placeField(requestId, {
          signerId,
          kind: field.kind,
          page: field.page,
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
          label: field.label,
          isRequired: field.isRequired,
        }),
      );
      state.postedFieldLocalIds.push(field.localId);
    }

    // Practitioner PIN (Form 8879): se fija mientras la solicitud está Draft/Ready (el backend solo lo
    // permite ahí). Opcional; idempotente por `state.pinSet`.
    const signingPin = draft.signingPin?.trim();
    if (signingPin && !state.pinSet) {
      await firstValueFrom(this.service.setPractitionerPin(requestId, signingPin));
      state.pinSet = true;
    }
  }

  /**
   * Send exige estado Ready; la promoción Draft→Ready llega cuando CloudStorage
   * termina el antivirus (evento FileAvailable). Se pollea el detalle unos segundos.
   */
  private async waitUntilReady(requestId: string): Promise<void> {
    for (let attempt = 0; attempt < READY_POLL_MAX_ATTEMPTS; attempt++) {
      const detail = await firstValueFrom(this.service.getById(requestId));
      if (detail.status !== 'Draft') {
        return; // Ready (o más allá): send decide el resto
      }
      await new Promise(resolve => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    }
    throw new SendNotReadyError(
      'The document is still being scanned by storage. The request was saved as a draft — retry sending in a few seconds.',
    );
  }
}

/** El documento sigue en scan: la solicitud quedó creada (Draft) y el retry solo re-espera + envía. */
export class SendNotReadyError extends Error {}
