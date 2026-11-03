import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Observable,
  catchError,
  concatMap,
  debounceTime,
  firstValueFrom,
  forkJoin,
  from,
  map,
  of,
  switchMap,
  tap,
  timer,
} from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { AuthService } from '@core/auth/auth.service';
import { Subject } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { SignatureRequest } from '../ui/signature-table/signature-table.component';
import { WizardClient } from '../ui/signature-request-panel/signature-wizard.model';
import { SignatureService } from './signature.service';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { injectEmbeddedCustomer } from '@core/customers/embedded-customer';
import { SignatureRealtimeService } from './signature-realtime.service';
import { rejectedDocumentMessage } from '../utils/document-verification.util';
import {
  ApiSignatureRequestStatus,
  SignatureCategory,
  SignatureFieldKind,
  SignerLanguage,
  SignerVerificationMethod,
  PreparerSessionState,
  SetPreparerBody,
  SignatureCategoryOption,
  SignatureProfile,
  SignatureProfileScope,
  EffectiveSignatureLimits,
  SignatureSettings,
  SignatureSettingsUpdate,
  SignatureRequestDetail,
  SignatureTemplateDetail,
  SlotBinding,
  TemplateSummary,
  UpdateSignatureRequestBody,
  UpsertDraftBody,
  UpsertDraftResponse,
  ValidateDocumentResponse,
  ReplaceDocumentFileResponse,
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

export interface TemplateDocumentInstantiationSource {
  templateDocumentId: string;
  source: { templateDoc: true } | { fileId: string } | { file: File };
  title?: string | null;
}

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
  documentLocalId: string;
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
  /** Letra del estampado en pt; null = automática. */
  fontSizePt?: number | null;
}

export interface WizardRequestDraft {
  title: string;
  description: string | null;
  category: SignatureCategory;
  documents: Array<{
    localId: string;
    backendId: string | null;
    originalFileId: string;
    title: string;
    note: string | null;
  }>;
  tokenExpirationHours: number;
  requiresSequentialSigning: boolean;
  requiresConsent: boolean;
  generateCertificate: boolean;
  certificateGenerationMode: 'SingleForRequest' | 'PerDocument';
  /** P2: entregar el documento firmado / el certificado a los firmantes (gateado por permiso en backend). */
  sendSealedDocumentToSigners: boolean;
  sendCertificateToSigners: boolean;
  // F7 — copia inmediata al firmar + audiencia.
  sendPartialCopyOnEachSignature: boolean;
  partialCopyAudienceKind: 'All' | 'Specific';
  partialCopyAudienceSignerIds: string[];
  // F7 — expiración opcional del enlace.
  expirationEnabled: boolean;
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
  /** Campos del preparador (canal paralelo). `signerLocalId` no aplica. */
  preparerFields: WizardFieldDraft[];
  /** FileId de la firma reutilizable a estampar por el preparador (null = la efectiva del backend). */
  preparerSignatureFileId: string | null;
  /** Identidad 8879 del preparador (PTIN/nombre/título); null = no se completó (no se fija). */
  preparerInfo: SetPreparerBody | null;
}

/**
 * Progreso del envío multi-paso (create → signers → fields → ready-wait → send).
 * Se conserva entre reintentos: si algo falla a mitad, la solicitud queda en
 * Draft/Ready en el backend y el retry retoma exactamente donde quedó.
 */
export interface WizardSendState {
  requestId: string | null;
  documentIdByLocal: Record<string, string>;
  signerIdByLocal: Record<string, string>;
  postedFieldLocalIds: string[];
  /** Ya se fijó el practitioner PIN (si el draft lo pedía) — evita re-fijarlo en un reintento. */
  pinSet: boolean;
  /** localIds de campos del preparador ya posteados (idempotencia entre reintentos). */
  postedPreparerFieldLocalIds: string[];
  /** Ya se fijó la firma reutilizable del preparador — evita re-PUT en un reintento. */
  preparerSignatureSet: boolean;
  /** Ya se fijó la identidad 8879 del preparador — idempotencia entre reintentos. */
  preparerInfoSet: boolean;
  /** F7 — ya se fijó la audiencia Specific con signerIds reales — idempotencia entre reintentos. */
  audienceApplied: boolean;
  sent: boolean;
}

export function emptySendState(): WizardSendState {
  return {
    requestId: null,
    documentIdByLocal: {},
    signerIdByLocal: {},
    postedFieldLocalIds: [],
    pinSet: false,
    postedPreparerFieldLocalIds: [],
    preparerSignatureSet: false,
    preparerInfoSet: false,
    audienceApplied: false,
    sent: false,
  };
}

export type WizardSendPhase = 'creating' | 'sending';

/** Lo que el borrador rehidratado ya tenía en el backend y el guardado por upsert no cubre. */
export interface DraftEditOriginal {
  /** Campos del preparador originales, para borrar los que el usuario quitó al editar. */
  preparerFields: { editorLocalId: string; fieldId: string }[];
}

/** Espera del autosave tras el último cambio del editor (colapsa ráfagas de drag/resize). */
const AUTOSAVE_DEBOUNCE_MS = 5000;

/** Campos que viajan en el upsert: los de un firmante que sigue en la solicitud. */
function upsertableFields(draft: WizardRequestDraft): WizardFieldDraft[] {
  const signerLocalIds = new Set(draft.signers.map((signer) => signer.localId));
  return draft.fields.filter((field) => signerLocalIds.has(field.signerLocalId));
}

/** Ids de backend de la audiencia Specific; null si algún firmante aún no existe en el backend. */
function specificAudienceIds(draft: WizardRequestDraft, state: WizardSendState): string[] | null {
  const ids = draft.partialCopyAudienceSignerIds.map((localId) => state.signerIdByLocal[localId]);
  return ids.every((id) => !!id) ? (ids as string[]) : null;
}

/** La audiencia Specific nombra firmantes nuevos: se fija después del upsert, ya con sus ids. */
function audienceWaitsForNewSigners(draft: WizardRequestDraft, state: WizardSendState): boolean {
  return (
    draft.sendPartialCopyOnEachSignature &&
    draft.partialCopyAudienceKind === 'Specific' &&
    specificAudienceIds(draft, state) === null
  );
}

/**
 * Estado completo del borrador en el shape de `PUT /requests/{id}/draft` (lo usan el autosave y el
 * guardado final). Lo ya creado viaja con su id de backend; lo nuevo sin id y el servidor lo crea, o lo
 * reconoce por archivo/email si un guardado anterior ya lo creó.
 */
export function draftToUpsertBody(
  draft: WizardRequestDraft,
  state: WizardSendState,
  expectedUpdatedAtUtc: string | null,
): UpsertDraftBody {
  const signerIndexByLocal = new Map(draft.signers.map((signer, index) => [signer.localId, index]));
  const audienceDeferred = audienceWaitsForNewSigners(draft, state);
  return {
    expectedUpdatedAtUtc,
    title: draft.title || 'Untitled',
    description: draft.description,
    category: draft.category,
    tokenExpirationHours: draft.tokenExpirationHours,
    sendSealedDocumentToSigners: draft.sendSealedDocumentToSigners,
    sendCertificateToSigners: draft.sendCertificateToSigners,
    certificateGenerationMode: draft.certificateGenerationMode,
    autoRemindersEnabled: draft.autoRemindersEnabled,
    reminderIntervalHours: draft.reminderIntervalHours,
    documents: draft.documents.map((document) => ({
      localId: document.localId,
      id: state.documentIdByLocal[document.localId] ?? null,
      originalFileId: document.originalFileId,
      title: document.title,
      note: document.note,
    })),
    signers: draft.signers.map((signer) => ({
      id: state.signerIdByLocal[signer.localId] ?? null,
      email: signer.email,
      fullName: signer.fullName,
      phoneNumber: signer.phone,
      language: signer.language,
      verificationMethod: signer.verificationMethod ?? null,
    })),
    fields: upsertableFields(draft).map((field) => ({
      id: null,
      signerIndex: signerIndexByLocal.get(field.signerLocalId)!,
      documentLocalId: field.documentLocalId,
      kind: field.kind,
      page: field.page,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      label: field.label,
      isRequired: field.isRequired,
      fontSizePt: field.fontSizePt ?? null,
    })),
    // null = no tocar: la audiencia que nombra firmantes nuevos se fija después, con sus ids.
    sendPartialCopyOnEachSignature: audienceDeferred ? null : draft.sendPartialCopyOnEachSignature,
    partialCopyAudience:
      audienceDeferred || !draft.sendPartialCopyOnEachSignature
        ? null
        : {
            kind: draft.partialCopyAudienceKind,
            signerIds:
              draft.partialCopyAudienceKind === 'Specific' ? (specificAudienceIds(draft, state) ?? []) : [],
          },
    expirationEnabled: draft.expirationEnabled,
  };
}

/**
 * Guarda en el `state` los ids que el servidor resolvió para ESE borrador (mismo orden que el body):
 * el siguiente guardado los manda con id en vez de volver a crearlos.
 */
export function applyUpsertResult(
  draft: WizardRequestDraft,
  state: WizardSendState,
  resp: UpsertDraftResponse,
): void {
  state.documentIdByLocal = Object.fromEntries(resp.documents.map((document) => [document.localId, document.id]));
  state.signerIdByLocal = Object.fromEntries(
    draft.signers
      .map((signer, index): [string, string | undefined] => [signer.localId, resp.signerIds[index]])
      .filter((entry): entry is [string, string] => !!entry[1]),
  );
  state.postedFieldLocalIds = upsertableFields(draft).map((field) => field.localId);
}

/**
 * Store del módulo Signature (staff): listado paginado en servidor + filtro de
 * estado server-side, detalle hidratado por fila (el summary no trae firmantes y la
 * tabla los muestra), picker de customers y orquestación del wizard.
 * providedIn: 'root', mismo patrón que clients/documents. Embebido en el perfil de un cliente
 * (`ClientSignatureWorkspaceComponent`) se provee una instancia propia y el listado se filtra
 * por `customerId` (ver `@core/customers/embedded-customer`).
 */
@Injectable({ providedIn: 'root' })
export class SignatureStore {
  private readonly service = inject(SignatureService);
  private readonly directory = inject(CustomerDirectoryStore);
  private readonly realtime = inject(SignatureRealtimeService);
  private readonly auth = inject(AuthService);
  /** Cliente fijo cuando el módulo está embebido en su perfil; null en la página global. */
  private readonly embedded = injectEmbeddedCustomer();

  constructor() {
    // Realtime: cuando alguien firma/rechaza o cambia el estado, Communication emite
    // `signature.request.changed` por-tenant. Refrescamos la lista (debounced para coalescer ráfagas
    // de varios firmantes) SOLO si ya se cargó alguna vez — si el usuario nunca abrió firmas, no
    // hay nada que refrescar y al abrirla se carga igual.
    this.realtime.connect();
    this.realtime.requestChanged$.pipe(debounceTime(400), takeUntilDestroyed()).subscribe(() => {
      if (this.refreshToken > 0) {
        this.refresh();
      }
    });

    // F2.5: autoguardado — el editor empuja el estado completo. Pipeline:
    //  - espera AUTOSAVE_DEBOUNCE_MS tras el último cambio; un cambio nuevo (o `flushAutosave`) descarta
    //    el pendiente.
    //  - concatMap: un guardado que ya salió nunca se cancela (el servidor pudo aplicarlo); termina y deja
    //    sus ids antes del siguiente.
    //  - Si el server responde 429, entramos en cooldown 30s (se refleja en scheduleAutosave) para
    //    no seguir empujando contra el rate-limit `signature.g.request_manage` (60/min).
    this.autosave$
      .pipe(
        switchMap((item) => (item ? timer(AUTOSAVE_DEBOUNCE_MS).pipe(map(() => item)) : EMPTY)),
        concatMap((item) => from(this.runAutosave(item))),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  // ---------- Autosave (F2.5) ----------
  // Snapshot completo del editor que el panel envía en cada cambio. SignerIndex ata cada campo al
  // firmante por su posición en la lista — soporta firmantes recién creados sin Id de backend.
  private readonly autosave$ = new Subject<AutosaveRequest | null>();
  /** Versión del borrador que el servidor espera en el próximo upsert (la del último guardado). */
  private draftVersion: string | null = null;
  /** Sube al descartar los autosaves pendientes: los encolados con otra generación ya no se mandan. */
  private autosaveGeneration = 0;
  private autosaveInFlight: Promise<void> | null = null;
  private lastSavedBodyJson: string | null = null;
  private readonly _autosaveStatus = signal<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>(
    'idle',
  );
  private readonly _lastSavedAtUtc = signal<string | null>(null);
  readonly autosaveStatus = this._autosaveStatus.asReadonly();
  readonly lastSavedAtUtc = this._lastSavedAtUtc.asReadonly();
  readonly autosaveEnabled = environment.signatureAutosaveEnabled === true;

  // Timestamp hasta el que el autosave está en cooldown (429 reciente). 0 = sin cooldown.
  private _autosaveCooldownUntil = 0;

  /** `onSaved` recibe los ids que el servidor resolvió para ESE body (ver `applyUpsertResult`). */
  scheduleAutosave(id: string, body: UpsertDraftBody, onSaved?: (resp: UpsertDraftResponse) => void): void {
    if (!this.autosaveEnabled) return;
    if (Date.now() < this._autosaveCooldownUntil) return; // cooldown por rate-limit del backend
    this._autosaveStatus.set('saving');
    this.autosave$.next({ id, body, onSaved, generation: this.autosaveGeneration });
  }

  /** Al abrir un borrador: su versión es la base de los guardados siguientes. */
  beginDraftEditing(updatedAtUtc: string): void {
    this.discardPendingAutosaves();
    this.draftVersion = updatedAtUtc;
    this.lastSavedBodyJson = null;
    this._autosaveStatus.set('idle');
    this._lastSavedAtUtc.set(null);
  }

  /** Descarta los autosaves pendientes y espera al que está en vuelo (deja sus ids antes de seguir). */
  private async flushAutosave(): Promise<void> {
    this.discardPendingAutosaves();
    await this.autosaveInFlight;
  }

  private discardPendingAutosaves(): void {
    this.autosaveGeneration++;
    this.autosave$.next(null);
  }

  private async runAutosave(item: AutosaveRequest): Promise<void> {
    if (item.generation !== this.autosaveGeneration) {
      return;
    }
    // Mismo contenido que lo último guardado: nada que mandar (la versión no cuenta).
    const json = JSON.stringify({ ...item.body, expectedUpdatedAtUtc: null });
    if (json === this.lastSavedBodyJson) {
      this._autosaveStatus.set('saved');
      return;
    }
    const run = this.saveDraftState(item, json);
    this.autosaveInFlight = run;
    try {
      await run;
    } finally {
      this.autosaveInFlight = null;
    }
  }

  private async saveDraftState(item: AutosaveRequest, json: string): Promise<void> {
    try {
      // La versión se toma al salir: un guardado anterior pudo avanzarla mientras este esperaba.
      const resp = await firstValueFrom(
        this.service.upsertDraft(item.id, {
          ...item.body,
          expectedUpdatedAtUtc: this.draftVersion ?? item.body.expectedUpdatedAtUtc,
        }),
      );
      this.draftVersion = resp.updatedAtUtc;
      this.lastSavedBodyJson = json;
      this._autosaveStatus.set('saved');
      this._lastSavedAtUtc.set(resp.updatedAtUtc);
      item.onSaved?.(resp);
    } catch (err) {
      const apiError = toApiError(err);
      this._autosaveStatus.set(apiError.code === 'Signature.Request.VersionConflict' ? 'conflict' : 'error');
      if (apiError.code === 'Http.429') {
        this._autosaveCooldownUntil = Date.now() + 30_000;
      }
    }
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
        customerId: this.embedded()?.id,
      })
      .pipe(
        switchMap((result) =>
          result.items.length === 0
            ? of({ result, details: [] as SignatureRequestDetail[] })
            : forkJoin(result.items.map((item) => this.service.getById(item.id))).pipe(
                map((details) => ({ result, details })),
              ),
        ),
      )
      .subscribe({
        next: ({ result, details }) => {
          if (token !== this.refreshToken) {
            return;
          }
          const uid = this.auth.currentUser()?.id ?? null;
          this._requests.set(details.map((d) => detailToUiRequest(d, uid)));
          this._totalCount.set(result.totalCount);
          this._loading.set(false);
          this.resolveSignerPhotos(token);
        },
        error: (err) => {
          if (token !== this.refreshToken) {
            return;
          }
          this._error.set(toApiError(err).message);
          this._loading.set(false);
        },
      });
  }

  /** Tras el refresh, pinta las fotos de los firmantes sin bloquear la tabla. */
  private resolveSignerPhotos(token: number): void {
    this.withSignerPhotos(this._requests()).subscribe((patched) => {
      if (token === this.refreshToken) {
        this._requests.set(patched);
      }
    });
  }

  /**
   * Fotos de los firmantes mapeados a un cliente: el detalle solo trae `mappedCustomerId`, así que se
   * resuelven con el directorio de clientes (cacheado). Best-effort: si falla quedan las iniciales.
   */
  private withSignerPhotos(requests: SignatureRequest[]): Observable<SignatureRequest[]> {
    const ids = [
      ...new Set(
        requests.flatMap((r) => r.signers.map((s) => s.customerId).filter((id): id is string => !!id)),
      ),
    ];
    if (ids.length === 0) {
      return of(requests);
    }
    return this.directory.byId(ids).pipe(
      map((found) =>
        requests.map((request) => ({
          ...request,
          signers: request.signers.map((signer) =>
            signer.customerId && found.has(signer.customerId)
              ? { ...signer, avatarFileId: found.get(signer.customerId)?.avatarFileId ?? null }
              : signer,
          ),
        })),
      ),
      catchError(() => of(requests)),
    );
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
    return this.service
      .extendExpiration(requestId, additionalHours)
      .pipe(tap(() => this.refreshAfterAction()));
  }

  /**
   * PIN del preparador: lo fija el staff y el firmante lo teclea en su paso de
   * verificación. Se refresca la lista porque el detalle expone
   * `requiresPractitionerPin` / `practitionerPinSetAtUtc` y la UI los muestra.
   */
  setPractitionerPin(requestId: string, pin: string): Observable<void> {
    return this.service
      .setPractitionerPin(requestId, pin)
      .pipe(tap(() => this.refreshAfterAction()));
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
    this._preparers.update((all) => {
      const current = all[requestId] ?? { info: null, signed: false };
      return { ...all, [requestId]: { ...current, ...patch } };
    });
  }

  setPreparer(requestId: string, body: SetPreparerBody): Observable<void> {
    return this.service
      .setPreparer(requestId, body)
      .pipe(tap(() => this.patchPreparer(requestId, { info: body })));
  }

  clearPreparer(requestId: string): Observable<void> {
    return this.service
      .clearPreparer(requestId)
      .pipe(tap(() => this.patchPreparer(requestId, { info: null, signed: false })));
  }

  signAsPreparer(requestId: string): Observable<void> {
    return this.service
      .signAsPreparer(requestId)
      .pipe(tap(() => this.patchPreparer(requestId, { signed: true })));
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
      next: (result) => {
        this.templates.set(result.items ?? []);
        this.templatesLoading.set(false);
      },
      error: (err) => {
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
      switchMap((validation) => {
        if (!validation.isAcceptable) {
          // `issues` son objetos {code, message}, no strings (la guía dice string[]).
          throw new Error(validation.issues[0]?.message ?? 'That PDF cannot be used for signing.');
        }
        return this.service.uploadOriginalDocument(file, validation.validationRecordId);
      }),
      switchMap((originalFileId) =>
        this.service.instantiateTemplate(templateId, {
          originalFileId,
          slotBindings,
          descriptionOverride,
        }),
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

  /** F3 — Programa el envio futuro (Draft → Scheduled). La fecha va en UTC. */
  scheduleSendRequest(requestId: string, scheduledSendAtUtc: string): Observable<void> {
    return this.service
      .scheduleSend(requestId, scheduledSendAtUtc)
      .pipe(tap(() => this.refreshAfterAction()));
  }

  /** F3 — Cancela la programacion (Scheduled → Draft). */
  cancelScheduleRequest(requestId: string): Observable<void> {
    return this.service.cancelSchedule(requestId).pipe(tap(() => this.refreshAfterAction()));
  }

  /** Detalle de una solicitud mapeado al shape de UI (para refrescar el preview tras una acción). */
  getRequestUi(requestId: string): Observable<SignatureRequest> {
    const uid = this.auth.currentUser()?.id ?? null;
    return this.service.getById(requestId).pipe(
      map((d) => detailToUiRequest(d, uid)),
      switchMap((request) => this.withSignerPhotos([request]).pipe(map(([withPhotos]) => withPhotos))),
    );
  }

  /** Detalle crudo del backend (para rehidratar el wizard al continuar un borrador). */
  getDetail(requestId: string): Observable<SignatureRequestDetail> {
    return this.service.getById(requestId);
  }

  /**
   * F9 — Reemplaza el PDF original de un documento del borrador. El backend decide si invalidar los
   * campos (page count distinto) y devuelve cuántos cayeron para que la UI pueda avisar.
   */
  replaceRequestDocumentFile(
    requestId: string,
    documentId: string,
    newFileId: string,
    newPageCount: number | null,
  ): Observable<ReplaceDocumentFileResponse> {
    return this.service.replaceRequestDocumentFile(requestId, documentId, {
      newFileId,
      newPageCount,
    });
  }

  // ---------- Categorías del tenant (14.5) ----------
  private readonly _categories = signal<SignatureCategoryOption[]>([]);
  private categoriesLoaded = false;
  readonly categories = this._categories.asReadonly();
  /** Las utilizables en el picker: sistema + custom no archivadas. */
  readonly activeCategories = computed(() => this._categories().filter((c) => !c.isArchived));

  loadCategories(force = false): void {
    if (this.categoriesLoaded && !force) {
      return;
    }
    // includeArchived=true: una sola carga sirve al picker (activeCategories filtra) y a la gestión (F4).
    this.service.listCategories(true).subscribe({
      next: (result) => {
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

  // ---------- Firmas reutilizables (My Signature) ----------
  private readonly _signatureProfiles = signal<SignatureProfile[]>([]);
  private signatureProfilesLoaded = false;
  readonly signatureProfiles = this._signatureProfiles.asReadonly();
  /** La firma por defecto del usuario/oficina utilizable (la primera default no archivada). */
  readonly defaultSignatureProfile = computed(
    () => this._signatureProfiles().find((p) => p.isDefault && !p.isArchived) ?? null,
  );
  /** Firmas seleccionables para estampar (no archivadas): propias + oficina. */
  readonly activeSignatureProfiles = computed(() =>
    this._signatureProfiles().filter((p) => !p.isArchived),
  );

  /** El backend dice si el actor puede gestionar/usar su firma personal (empleado con toggle OFF → false). */
  private readonly _canManageOwnSignature = signal(true);
  readonly canManageOwnSignature = this._canManageOwnSignature.asReadonly();

  loadSignatureProfiles(force = false): void {
    if (this.signatureProfilesLoaded && !force) {
      return;
    }
    // includeArchived=true: una carga sirve al manager (que muestra archivadas) y al picker (filtra).
    this.service.listSignatureProfiles(true).subscribe({
      next: (result) => {
        this._signatureProfiles.set(result.profiles);
        this._canManageOwnSignature.set(result.canManageOwnSignature ?? true);
        this.signatureProfilesLoaded = true;
      },
      error: () => {
        // El manager reintenta al reabrir; sin firmas el editor cae al sello tipográfico del backend.
      },
    });
  }

  createSignatureProfile(body: {
    label: string;
    scope: SignatureProfileScope;
    imageBase64: string;
  }): Observable<SignatureProfile> {
    return this.service
      .createSignatureProfile(body)
      .pipe(tap(() => this.loadSignatureProfiles(true)));
  }

  renameSignatureProfile(id: string, label: string): Observable<void> {
    return this.service
      .renameSignatureProfile(id, label)
      .pipe(tap(() => this.loadSignatureProfiles(true)));
  }

  setDefaultSignatureProfile(id: string): Observable<void> {
    return this.service
      .setDefaultSignatureProfile(id)
      .pipe(tap(() => this.loadSignatureProfiles(true)));
  }

  archiveSignatureProfile(id: string): Observable<void> {
    return this.service
      .archiveSignatureProfile(id)
      .pipe(tap(() => this.loadSignatureProfiles(true)));
  }

  unarchiveSignatureProfile(id: string): Observable<void> {
    return this.service
      .unarchiveSignatureProfile(id)
      .pipe(tap(() => this.loadSignatureProfiles(true)));
  }

  deleteSignatureProfile(id: string): Observable<void> {
    return this.service
      .deleteSignatureProfile(id)
      .pipe(tap(() => this.loadSignatureProfiles(true)));
  }

  // ---------- Límites vigentes (plan + excepción + oficina + plataforma) ----------
  private readonly _limits = signal<EffectiveSignatureLimits | null>(null);
  /** null mientras no llegan: los formularios no inventan números, solo esperan. */
  readonly limits = this._limits.asReadonly();
  private limitsRequested = false;

  /** Se pide una vez por sesión del feature; cambiar ajustes vuelve a pedirlo. */
  loadLimits(force = false): void {
    if (this.limitsRequested && !force) {
      return;
    }
    this.limitsRequested = true;
    this.service.getEffectiveLimits().subscribe({
      next: (limits) => this._limits.set(limits),
      error: () => {
        this.limitsRequested = false;
      },
    });
  }

  // ---------- Gobernanza de firma (solo admin) ----------
  private readonly _signatureSettings = signal<SignatureSettings | null>(null);
  readonly signatureSettings = this._signatureSettings.asReadonly();

  loadSignatureSettings(): void {
    this.service.getSignatureSettings().subscribe({
      next: (settings) => this._signatureSettings.set(settings),
      error: () => {
        // 403 si no es admin, o sin sesión: la sección de gobernanza no se muestra.
      },
    });
  }

  /** Cambia solo el toggle re-enviando el resto de la config tal cual (PUT de reemplazo del backend). */
  setAllowEmployeeOwnSignature(allow: boolean): Observable<void> {
    const s = this._signatureSettings();
    if (!s) {
      return of(undefined);
    }
    return this.service
      .updateSignatureSettings({
        allowedVerificationChannels: s.allowedVerificationChannels,
        defaultVerificationChannel: s.defaultVerificationChannel,
        defaultTokenExpirationHours: s.defaultTokenExpirationHours,
        remindersEnabledByDefault: s.remindersEnabledByDefault,
        generateCertificateByDefault: s.generateCertificateByDefault,
        documentLimits: {
          maxPdfBytes: s.maxPdfBytes,
          maxPagesPerDocument: s.maxPagesPerDocument,
        },
        retentionPolicy: { allowPurge: s.allowPurge },
        defaultReminderIntervalHours: s.defaultReminderIntervalHours,
        allowEmployeeOwnSignature: allow,
      })
      .pipe(tap(() => this._signatureSettings.set({ ...s, allowEmployeeOwnSignature: allow })));
  }

  /** B1 — guarda la configuración global completa (PUT de reemplazo) y refresca el signal con la verdad del servidor. */
  saveSignatureSettings(body: SignatureSettingsUpdate): Observable<void> {
    return this.service.updateSignatureSettings(body).pipe(
      tap(() => {
        this.loadSignatureSettings();
        this.loadLimits(true);
      }),
    );
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
        this.instantiateTemplateWithFileId(
          templateId,
          source.fileId,
          slotBindings,
          descriptionOverride,
        ),
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
      throw toWizardError(err);
    }
  }

  async instantiateMultiDocumentTemplateAndSend(
    templateId: string,
    documentSources: TemplateDocumentInstantiationSource[],
    slotBindings: SlotBinding[],
    descriptionOverride: string | null,
    onPhase?: (phase: 'creating' | 'preparing' | 'sending') => void,
  ): Promise<{ detail: SignatureRequestDetail; sent: boolean }> {
    onPhase?.('creating');
    const documents: Array<{
      templateDocumentId: string;
      originalFileId: string;
      title?: string | null;
    }> = [];
    for (const document of documentSources) {
      if ('templateDoc' in document.source) {
        continue;
      }
      let originalFileId: string;
      if ('fileId' in document.source) {
        originalFileId = document.source.fileId;
      } else {
        const validation = await firstValueFrom(
          this.service.validateDocument(document.source.file),
        );
        if (!validation.isAcceptable) {
          throw new Error(validation.issues[0]?.message ?? 'That PDF cannot be used for signing.');
        }
        originalFileId = await firstValueFrom(
          this.service.uploadOriginalDocument(document.source.file, validation.validationRecordId),
        );
      }
      documents.push({
        templateDocumentId: document.templateDocumentId,
        originalFileId,
        title: document.title ?? null,
      });
    }

    const detail = await firstValueFrom(
      this.service.instantiateTemplate(templateId, {
        documents,
        slotBindings,
        descriptionOverride,
      }),
    );
    this.refreshAfterAction();

    try {
      onPhase?.('preparing');
      await this.waitUntilReady(detail.id);
      onPhase?.('sending');
      await firstValueFrom(this.service.send(detail.id));
      this.refreshAfterAction();
      return { detail, sent: true };
    } catch (err) {
      this.refreshAfterAction();
      if (err instanceof SendNotReadyError) {
        return { detail, sent: false };
      }
      throw toWizardError(err);
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
    const pending = request.signers.filter((s) => s.status === 'pending' && s.id);
    if (pending.length === 0) {
      return of(undefined);
    }
    return forkJoin(
      pending.map((s) => this.service.resendSignerInvitation(request.id, s.id!)),
    ).pipe(map(() => undefined));
  }

  /** URL presignada de descarga (sealed / certificate / original) vía CloudStorage. */
  getDownloadUrl(fileId: string): Observable<string> {
    return this.service.getDownloadUrl(fileId);
  }

  private refreshAfterAction(): void {
    this.refresh();
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
      next: (result) => {
        if (seq !== this.customersReqSeq) {
          return; // llegó tarde: una búsqueda posterior ya manda
        }
        this._customers.set(result.items.map(customerToWizardClient));
        this.customersLoaded = true;
        this._customersLoading.set(false);
      },
      error: (err) => {
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
      throw toWizardError(err);
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
      throw toWizardError(err);
    }
  }

  /**
   * Guardar/enviar un borrador ya existente (continuar edición): el estado completo va por el mismo
   * upsert que el autosave (documentos, firmantes, campos, orden y metadata en una transacción), así
   * nunca se re-crea lo que un autosave ya guardó. Después, lo que el upsert no cubre (campos del
   * preparador quitados, PIN, identidad/firma del preparador, audiencia con firmantes nuevos) y — si
   * `send` — el envío.
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
      await this.flushAutosave();
      const audienceDeferred = audienceWaitsForNewSigners(draft, state);
      const resp = await firstValueFrom(
        this.service.upsertDraft(requestId, draftToUpsertBody(draft, state, this.draftVersion)),
      );
      this.draftVersion = resp.updatedAtUtc;
      applyUpsertResult(draft, state, resp);
      state.audienceApplied = !audienceDeferred;

      // Campos del preparador que ya no están en la edición → borrar.
      const currentPreparerLocalIds = new Set(draft.preparerFields.map((f) => f.localId));
      for (const field of original.preparerFields) {
        if (!currentPreparerLocalIds.has(field.editorLocalId)) {
          await firstValueFrom(this.service.removePreparerField(requestId, field.fieldId));
        }
      }

      // PIN, preparador y audiencia; firmantes y campos ya quedaron mapeados por el upsert.
      await this.materializeDraft(draft, state);

      if (send && !state.sent) {
        onPhase?.('sending');
        await this.waitUntilReady(requestId);
        await firstValueFrom(this.service.send(requestId));
        state.sent = true;
      }

      this.refreshAfterAction();
      return state;
    } catch (err) {
      throw toWizardError(err);
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
          documents: draft.documents.map((document) => ({
            originalFileId: document.originalFileId,
            title: document.title,
            note: document.note,
          })),
          tokenExpirationHours: draft.tokenExpirationHours,
          requiresSequentialSigning: draft.requiresSequentialSigning,
          requiresConsent: draft.requiresConsent,
          generateCertificate: draft.generateCertificate,
          certificateGenerationMode: draft.certificateGenerationMode,
          sendSealedDocumentToSigners: draft.sendSealedDocumentToSigners,
          sendCertificateToSigners: draft.sendCertificateToSigners,
          autoRemindersEnabled: draft.autoRemindersEnabled,
          reminderIntervalHours: draft.reminderIntervalHours,
          // F7 — propagamos los flags elegidos en Review al backend.
          sendPartialCopyOnEachSignature: draft.sendPartialCopyOnEachSignature,
          // La audiencia Specific se fija DESPUÉS, con los signerIds reales del backend (acá los
          // locales son `client:xxx`). Create exige audience si sendPartialCopy=true, así que
          // mandamos All como placeholder seguro — el PUT update siguiente la convierte a Specific
          // si corresponde. Si el user solo Save-as-draft y nunca hace el PUT, All es el default
          // razonable.
          partialCopyAudience: draft.sendPartialCopyOnEachSignature
            ? { kind: 'All', signerIds: [] }
            : null,
          expirationEnabled: draft.expirationEnabled,
        }),
      );
      state.requestId = created.id;
      created.documents.forEach((document, index) => {
        const localId = draft.documents[index]?.localId;
        if (localId) {
          state.documentIdByLocal[localId] = document.id;
        }
      });
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
      const documentId = state.documentIdByLocal[field.documentLocalId];
      if (!signerId || !documentId) {
        continue; // firmante eliminado entre reintentos: campo huérfano, se omite
      }
      await firstValueFrom(
        this.service.placeField(requestId, {
          signerId,
          documentId,
          kind: field.kind,
          page: field.page,
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
          label: field.label,
          isRequired: field.isRequired,
          fontSizePt: field.fontSizePt ?? null,
        }),
      );
      state.postedFieldLocalIds.push(field.localId);
    }

    // F7 — audiencia Specific se fija ACÁ, cuando ya existen los signerIds reales del backend.
    // En Create no se podía (eran localIds `client:xxx`). Idempotente por `audienceApplied`.
    if (
      draft.sendPartialCopyOnEachSignature &&
      draft.partialCopyAudienceKind === 'Specific' &&
      !state.audienceApplied
    ) {
      const resolvedIds = draft.partialCopyAudienceSignerIds
        .map((local) => state.signerIdByLocal[local])
        .filter((id): id is string => !!id);
      if (resolvedIds.length > 0) {
        await firstValueFrom(
          this.service.update(requestId, {
            title: draft.title,
            description: draft.description,
            category: draft.category,
            tokenExpirationHours: draft.tokenExpirationHours,
            sendPartialCopyOnEachSignature: true,
            partialCopyAudience: { kind: 'Specific', signerIds: resolvedIds },
          }),
        );
        state.audienceApplied = true;
      }
    }

    // Practitioner PIN (Form 8879): se fija mientras la solicitud está Draft/Ready (el backend solo lo
    // permite ahí). Opcional; idempotente por `state.pinSet`.
    const signingPin = draft.signingPin?.trim();
    if (signingPin && !state.pinSet) {
      await firstValueFrom(this.service.setPractitionerPin(requestId, signingPin));
      state.pinSet = true;
    }

    // Identidad 8879 del preparador (opcional): se fija mientras Draft/Ready (EnsureCanBeEdited), igual que
    // el PIN — así no hace falta guardar como borrador primero. Idempotente por `preparerInfoSet`.
    if (draft.preparerInfo && !state.preparerInfoSet) {
      await firstValueFrom(this.service.setPreparer(requestId, draft.preparerInfo));
      state.preparerInfoSet = true;
    }

    // Firma del preparador (canal paralelo): fija qué firma estampar + coloca sus campos. Solo si hay
    // campos del preparador; idempotente por `preparerSignatureSet` / `postedPreparerFieldLocalIds`.
    if (draft.preparerFields.length > 0) {
      if (!state.preparerSignatureSet) {
        await firstValueFrom(
          this.service.setPreparerSignature(requestId, draft.preparerSignatureFileId),
        );
        state.preparerSignatureSet = true;
      }
      for (const field of draft.preparerFields) {
        if (state.postedPreparerFieldLocalIds.includes(field.localId)) {
          continue;
        }
        const documentId = state.documentIdByLocal[field.documentLocalId];
        if (!documentId) {
          continue;
        }
        await firstValueFrom(
          this.service.placePreparerField(requestId, {
            documentId,
            kind: field.kind,
            page: field.page,
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height,
            label: field.label,
          }),
        );
        state.postedPreparerFieldLocalIds.push(field.localId);
      }
    }
  }

  /**
   * Send exige que el hash del original este adjunto. Lo adjunta el consumer
   * de `FileAvailable` cuando CloudStorage termina el antivirus — es la unica
   * promocion que depende del scan ahora (F2 eliminó Ready: el estado se queda
   * en Draft hasta que el preparador envie). Se pollea `documentHashPre`,
   * no el status.
   */
  private async waitUntilReady(requestId: string): Promise<void> {
    for (let attempt = 0; attempt < READY_POLL_MAX_ATTEMPTS; attempt++) {
      const detail = await firstValueFrom(this.service.getById(requestId));
      // Rechazado por el servidor: esperar no sirve, hay que reemplazar el archivo.
      const rejected = rejectedDocumentMessage(detail.documents);
      if (rejected) {
        throw new DocumentRejectedError(rejected);
      }
      if (
        detail.documents.length > 0 &&
        detail.documents.every((document) => document.hashPre !== null)
      ) {
        return; // Hash adjunto → send puede proceder
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    }
    throw new SendNotReadyError(
      'The document is still being scanned by storage. The request was saved as a draft — retry sending in a few seconds.',
    );
  }
}

interface AutosaveRequest {
  id: string;
  body: UpsertDraftBody;
  onSaved?: (resp: UpsertDraftResponse) => void;
  generation: number;
}

/** El documento sigue en scan: la solicitud quedó creada (Draft) y el retry solo re-espera + envía. */
export class SendNotReadyError extends Error {}

/** El servidor rechazó un documento: la solicitud quedó en Draft y hay que reemplazar el archivo. */
export class DocumentRejectedError extends Error {}

/** Códigos con que el servidor rechaza un PDF (al crear la solicitud o al revisarlo después). */
const DOCUMENT_REJECTION_CODE_PREFIX = 'Signature.DocumentValidation.';

/**
 * Error del wizard con su tipo conservado: el panel decide con él si sugerir reintentar
 * (fallo transitorio) o reemplazar el archivo (rechazo del documento).
 */
export function toWizardError(err: unknown): Error {
  if (err instanceof SendNotReadyError || err instanceof DocumentRejectedError) {
    return err;
  }
  const apiError = toApiError(err);
  return apiError.code.startsWith(DOCUMENT_REJECTION_CODE_PREFIX)
    ? new DocumentRejectedError(apiError.message)
    : new Error(apiError.message);
}
