import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SignatureWizardClientStepComponent } from '../signature-wizard-client-step/signature-wizard-client-step.component';
import { SignatureWizardDocumentStepComponent } from '../signature-wizard-document-step/signature-wizard-document-step.component';
import { SignatureWizardReviewStepComponent } from '../signature-wizard-review-step/signature-wizard-review-step.component';
import { NormalizedPlacedField, SignaturePdfEditorComponent } from '../signature-pdf-editor/signature-pdf-editor.component';
import {
  EditorSeed,
  EditorSeedField,
  EditorSigner,
  PREPARER_PARTY_ID,
  PlacedField,
  RequestRules,
  WizardClient,
  WizardDocument,
} from './signature-wizard.model';
import {
  WizardDraftSnapshot,
  clearDraftSnapshot,
  readDraftSnapshot,
  writeDraftSnapshot,
} from '../../utils/wizard-draft-recovery.util';
import {
  ApiSignatureRequestStatus,
  SetPreparerBody,
  SignatureCategory,
  TOKEN_EXPIRATION_DEFAULT_HOURS,
  TOKEN_EXPIRATION_MAX_HOURS,
  TOKEN_EXPIRATION_MIN_HOURS,
  UpsertDraftBody,
  UpsertDraftField,
  UpsertDraftSigner,
  channelToVerificationMethod,
  customerToWizardClient,
  fieldTypeToKind,
} from '../../data-access/signature.model';
import {
  DraftEditOriginal,
  SignatureStore,
  WizardRequestDraft,
  WizardSendState,
  emptySendState,
} from '../../data-access/signature.store';
import { buildDraftHydration } from '../../utils/draft-hydration.util';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { isSigningPinInvalid } from '../../utils/request-rules.util';
import { signersMissingSignature } from '../../utils/editor-fields.util';
import { PDF_RENDER_FRIENDLY_ERROR } from '../../utils/pdf-render.util';

type WizardStep = 1 | 2 | 3 | 4;

/** Fases de la coreografía de envío: el papel se crea → se firma → sale. */
type SendPhase = 'idle' | 'paper' | 'signing' | 'done';

/**
 * Wizard de "New Signature Request" contra el backend real: cliente (Customer.Api)
 * → documento (preflight /signature/documents/validate + upload a CloudStorage) →
 * editor de campos sobre el PDF → review → envío multi-paso (create → signers →
 * fields → send). Es un takeover in-page (mismo patrón que la vista previa).
 * Cada paso es un sub-componente; el editor (paso 3) queda montado (oculto en
 * los demás pasos) para preservar los campos al navegar, y al pasar 3→4 se
 * snapshotean firmantes/campos (también normalizados 0..1) para el resumen y el POST.
 * Si el envío falla a mitad, la solicitud queda en Draft en el backend y el
 * progreso (`sendState`) se conserva para que Retry no duplique nada.
 */
@Component({
  selector: 'app-signature-request-panel',
  imports: [
    CommonModule,
    FormsModule,
    SignatureWizardClientStepComponent,
    SignatureWizardDocumentStepComponent,
    SignatureWizardReviewStepComponent,
    SignaturePdfEditorComponent,
    ConfirmDialogComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-request-panel.component.html',
  styleUrl: './signature-request-panel.component.css',
})
export class SignatureRequestPanelComponent implements OnChanges, OnInit {
  /** Cuando viene un id, el wizard se abre para CONTINUAR ese borrador (rehidratado), no para crear uno. */
  @Input() continueRequestId: string | null = null;

  @Output() closed = new EventEmitter<void>();
  /** El backend ya mandó los emails (POST send → 202): el padre solo refresca y cierra. */
  @Output() sent = new EventEmitter<void>();
  /** Guardado como borrador sin enviar: el padre refresca la lista, avisa y cierra. */
  @Output() saved = new EventEmitter<void>();

  /** Query con signal: los computed (canProceed/canSaveDraft) siguen al editor aunque se resuelva tarde. */
  private readonly editorRef = viewChild<SignaturePdfEditorComponent>('editor');
  private get editor(): SignaturePdfEditorComponent | undefined {
    return this.editorRef();
  }

  readonly store = inject(SignatureStore);
  private readonly toast = inject(ToastService);
  private readonly directory = inject(CustomerDirectoryStore);

  readonly currentStep = signal<WizardStep>(1);
  /** Rehidratando un borrador (fetch del detalle + bytes del PDF). */
  readonly hydrating = signal(false);
  readonly hydrateError = signal('');
  /** true cuando el wizard se abrió para continuar un borrador (cambia títulos/CTA). */
  readonly editingDraft = signal(false);
  /** Siembra del editor al continuar un borrador (firmantes + campos + reglas). */
  readonly editorSeed = signal<EditorSeed | null>(null);
  /** Snapshot local de recuperación disponible al abrir (recarga/cierre previo). Se ofrece restaurar. */
  readonly recoverable = signal<WizardDraftSnapshot | null>(null);
  /** Ids originales del borrador (para el diff al guardar/enviar). null = creación nueva. */
  private original: DraftEditOriginal | null = null;
  readonly selectedClient = signal<WizardClient | null>(null);
  /** Últimos clientes elegidos (recientes del directorio compartido), para el acceso rápido del paso 1. */
  readonly recentClients = computed(() => this.directory.recent());
  readonly selectedDocument = signal<WizardDocument | null>(null);
  /**
   * Documento que renderiza el editor. Va aparte de `selectedDocument` para que re-elegir el PDF en
   * el paso 2 no borre los campos colocados hasta que el usuario lo confirme (ver onDocumentSelected).
   */
  readonly editorDocument = signal<WizardDocument | null>(null);
  /** Documento nuevo en espera de confirmar el reemplazo (hay campos colocados sobre el actual). */
  readonly pendingDocument = signal<WizardDocument | null>(null);
  /** Opción "conservar campos" del diálogo de reemplazo. */
  readonly keepFieldsChoice = signal(true);
  /** Se pasa al editor: true = al cambiar de documento conserva los campos (posición relativa). */
  readonly keepFieldsOnDocumentChange = signal(false);
  /** Diálogo "descartar cambios" al cerrar con trabajo sin guardar. */
  readonly confirmCloseOpen = signal(false);
  /** Metadata editada tras rehidratar un borrador (título, categoría, fecha, descripción). */
  private readonly metaDirty = signal(false);
  readonly title = signal('');
  readonly category = signal<SignatureCategory>('Fiscal');
  readonly dueDate = signal('');
  readonly notes = signal('');
  readonly fieldCount = signal(0);

  /** Snapshots tomados al pasar 3→4 (el editor sigue montado para que Back preserve). */
  readonly signersSnapshot = signal<EditorSigner[]>([]);
  readonly fieldsSnapshot = signal<PlacedField[]>([]);
  readonly normalizedFieldsSnapshot = signal<NormalizedPlacedField[]>([]);
  /** Campos del preparador (canal paralelo) congelados al salir del editor. */
  readonly preparerFieldsSnapshot = signal<NormalizedPlacedField[]>([]);
  /** FileId de la firma reutilizable a estampar por el preparador (null = la efectiva). */
  readonly preparerSignatureFileIdSnapshot = signal<string | null>(null);
  /** Identidad 8879 del preparador capturada inline (null = no se completó). */
  readonly preparerInfoSnapshot = signal<SetPreparerBody | null>(null);
  readonly rulesSnapshot = signal<RequestRules | null>(null);

  /** Progreso del envío multi-paso; sobrevive a fallos parciales para reintentar sin duplicar. */
  private sendState: WizardSendState = emptySendState();
  // F2.5: versión del backend para optimistic concurrency en el autosave. Se seed al hidratar y la
  // mantiene el store (lastSavedAtUtc) cuando cada upsert responde.
  private hydratedUpdatedAtUtc: string | null = null;
  readonly sendError = signal('');
  // F3 — picker inline del Schedule send (Review step).
  readonly scheduleOpen = signal(false);
  readonly scheduleAtLocal = signal('');
  readonly scheduling = signal(false);
  readonly scheduleError = signal('');

  /** Guardando como borrador (sin enviar). */
  readonly savingDraft = signal(false);

  /** Coreografía de envío (overlay a pantalla completa). */
  readonly sendPhase = signal<SendPhase>('idle');
  readonly isSending = computed(() => this.sendPhase() !== 'idle');
  readonly sendCaption = computed(() => {
    switch (this.sendPhase()) {
      case 'paper':
        return 'Creating request…';
      case 'signing':
        return 'Sending to signers…';
      case 'done':
        return 'Request sent';
      default:
        return '';
    }
  });
  /** Líneas del "papel" del overlay (solo presentación). */
  readonly paperLines = [92, 76, 84, 60, 88];

  readonly steps: WizardStep[] = [1, 2, 3, 4];
  readonly stepTitles = ['Client', 'Document', 'Fields', 'Review'];
  readonly stepSubtitles = [
    'Choose who this request is for',
    'Upload the PDF to sign',
    'Place the signature fields',
    'Review everything and send',
  ];
  readonly stepTitle = computed(() => this.stepTitles[this.currentStep() - 1]);
  readonly stepSubtitle = computed(() => this.stepSubtitles[this.currentStep() - 1]);

  readonly canProceed = computed(() => {
    switch (this.currentStep()) {
      case 1:
        return this.selectedClient() !== null;
      case 2:
        // El documento debe haber pasado el preflight Y estar ya en CloudStorage.
        return !!this.selectedDocument()?.fileId;
      case 3:
        // Cada firmante con al menos una Firma/Iniciales (los del preparador no cuentan), documento
        // renderizado y sin teléfonos/datos 8879 pendientes: lo mismo que lista "Before you continue".
        return this.fieldCount() > 0 && (this.editor?.canContinue() ?? false);
      default:
        return true;
    }
  });

  /** Motivos que bloquean "Send" (se muestran sobre el pie; el botón no queda deshabilitado "porque sí"). */
  readonly sendBlockers = computed<string[]>(() => {
    const out: string[] = [];
    const titleLength = this.title().trim().length;
    if (titleLength < 3 || titleLength > 300) {
      out.push('Add a title between 3 and 300 characters.');
    }
    const missing = signersMissingSignature(this.signersSnapshot(), this.fieldsSnapshot());
    if (missing.length > 0) {
      out.push(
        missing.length === 1
          ? `${missing[0].name} still needs a Signature or Initials field.`
          : `${missing.length} signers still need a Signature or Initials field.`,
      );
    } else if (!this.normalizedFieldsSnapshot().some(f => f.type === 'signature' || f.type === 'initials')) {
      out.push('Place at least one Signature or Initials field.');
    }
    if (isSigningPinInvalid(this.rulesSnapshot())) {
      out.push('The Signing PIN must be 4–10 digits, or leave it empty.');
    }
    return out;
  });

  readonly canSend = computed(() => {
    const doc = this.selectedDocument();
    const titleLength = this.title().trim().length;
    return (
      this.selectedClient() !== null &&
      !!doc?.fileId &&
      titleLength >= 3 &&
      titleLength <= 300 &&
      this.normalizedFieldsSnapshot().length > 0 &&
      // Regla del dominio: al menos un campo Signature o Initials para poder enviar.
      this.normalizedFieldsSnapshot().some(f => f.type === 'signature' || f.type === 'initials') &&
      // Y cada firmante con el suyo (los del preparador no cuentan), y el PIN válido si se escribió.
      signersMissingSignature(this.signersSnapshot(), this.fieldsSnapshot()).length === 0 &&
      !isSigningPinInvalid(this.rulesSnapshot())
    );
  });

  /** Guardar como borrador exige cliente, documento subido y un título válido; el resto es opcional. */
  readonly canSaveDraft = computed(() => {
    const titleLength = this.title().trim().length;
    return (
      this.selectedClient() !== null &&
      !!this.selectedDocument()?.fileId &&
      titleLength >= 3 &&
      titleLength <= 300 &&
      // Nunca con el render fallido o a medias: exportaría un set vacío y el diff borraría campos del servidor.
      (this.editor?.safeToExport() ?? true)
    );
  });

  /** Motivo visible cuando el render impide guardar ('' = nada que decir). */
  readonly saveBlockedReason = computed(() => this.editor?.exportBlockedReason() ?? '');

  /** Primer pendiente del paso Fields + cuántos hay (pista junto al botón Next). */
  readonly stepHint = computed(() => {
    const step = this.currentStep();
    if (step === 3) {
      const items = this.editor?.readinessItems() ?? [];
      if (items.length === 0) {
        return '';
      }
      return items.length === 1 ? items[0].message : `${items[0].message} (+${items.length - 1} more)`;
    }
    if (step === 4) {
      return this.sendBlockers()[0] ?? '';
    }
    return '';
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['continueRequestId'] && this.continueRequestId) {
      void this.hydrateFromDraft(this.continueRequestId);
    }
  }

  ngOnInit(): void {
    // Solo en modo CREAR (no continuar): si hay un snapshot de recuperación de una sesión anterior
    // (recarga/cierre accidental), ofrecemos restaurar el trabajo del editor.
    if (!this.continueRequestId) {
      const snapshot = readDraftSnapshot();
      if (snapshot) {
        this.recoverable.set(snapshot);
      }
    }
  }

  // Autoguardado de recuperación: se escribe SOLO al ocultarse/cerrarse la página (recarga, cierre de
  // pestaña/navegador) y únicamente si hay campos colocados. Nada de red ni escrituras por tecla → cero
  // impacto en el performance mientras se trabaja.
  @HostListener('window:pagehide')
  onPageHide(): void {
    this.persistRecoverySnapshot();
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.hidden) {
      this.persistRecoverySnapshot();
    }
  }

  private persistRecoverySnapshot(): void {
    // No en modo continuar (ese draft ya vive en el backend), y solo con cliente + documento subido.
    // Tampoco con el render fallido/a medias: el snapshot saldría sin campos y pisaría uno bueno.
    if (this.editingDraft() || !this.editor || !this.editor.safeToExport()) {
      return;
    }
    const client = this.selectedClient();
    const doc = this.selectedDocument();
    if (!client || !doc?.fileId) {
      return;
    }
    const seed = this.buildEditorSeedFromLive();
    if (seed.fields.length === 0) {
      return; // "siempre y cuando hagamos cambios en el editor": sin campos no se guarda nada
    }
    writeDraftSnapshot({
      savedAt: Date.now(),
      client,
      documentFileId: doc.fileId,
      documentName: doc.name,
      title: this.title(),
      category: this.category(),
      dueDate: this.dueDate(),
      notes: this.notes(),
      seed,
    });
  }

  /** Serializa el estado vivo del editor a un EditorSeed (mismo shape que usa la rehidratación). */
  private buildEditorSeedFromLive(): EditorSeed {
    const editor = this.editor!;
    const toSeedField = (f: NormalizedPlacedField): EditorSeedField => ({
      localId: f.localId,
      type: f.type,
      page: f.page,
      nx: f.x,
      ny: f.y,
      nw: f.width,
      nh: f.height,
      signerLocalId: f.signerLocalId,
      label: f.label,
    });
    const signerFields = editor.buildNormalizedFields().map(toSeedField);
    const preparerFields = editor
      .buildPreparerFields()
      .map(f => ({ ...toSeedField(f), signerLocalId: PREPARER_PARTY_ID }));
    return {
      signers: editor.getSigners(),
      fields: [...signerFields, ...preparerFields],
      rules: editor.getRules(),
      preparerSignatureFileId: editor.getPreparerSignatureFileId(),
      preparerInfo: editor.getPreparerInfo(),
    };
  }

  /** Restaura el trabajo del snapshot: cliente, metadata, documento (re-descargado) y siembra del editor. */
  async restoreDraft(): Promise<void> {
    const snapshot = this.recoverable();
    if (!snapshot) {
      return;
    }
    this.recoverable.set(null);
    this.hydrating.set(true);
    this.hydrateError.set('');
    try {
      this.selectedClient.set(snapshot.client);
      this.title.set(snapshot.title);
      this.category.set(snapshot.category);
      this.notes.set(snapshot.notes);
      this.dueDate.set(snapshot.dueDate);
      this.editorSeed.set(snapshot.seed);

      const url = await firstValueFrom(this.store.getDownloadUrl(snapshot.documentFileId));
      const blob = await this.fetchPdfBlob(url);
      this.setDocument({
        id: snapshot.documentFileId,
        name: snapshot.documentName,
        kind: 'pdf',
        size: '',
        date: '',
        blob,
        fileId: snapshot.documentFileId,
      });
      this.currentStep.set(3);
    } catch (err) {
      console.error('[signature] restore failed', err);
      this.hydrateError.set(`Your unsaved work could not be restored. ${PDF_RENDER_FRIENDLY_ERROR}`);
    } finally {
      this.hydrating.set(false);
    }
  }

  discardRecovery(): void {
    clearDraftSnapshot();
    this.recoverable.set(null);
  }

  /**
   * Reabre el wizard sobre un borrador existente: trae el detalle, reconstruye cliente/metadata,
   * re-descarga los bytes del PDF y siembra el editor (firmantes + campos). El `sendState` queda
   * pre-poblado para no re-crear nada; al guardar/enviar se calcula el diff (ver commitEditedDraft).
   */
  private async hydrateFromDraft(requestId: string): Promise<void> {
    this.editingDraft.set(true);
    this.hydrating.set(true);
    this.hydrateError.set('');
    try {
      const detail = await firstValueFrom(this.store.getDetail(requestId));
      const hydration = buildDraftHydration(detail);

      this.selectedClient.set(hydration.client);
      this.title.set(hydration.metadata.title);
      this.category.set(hydration.metadata.category);
      this.notes.set(hydration.metadata.description);
      this.dueDate.set(hydration.metadata.dueDate);
      this.editorSeed.set(hydration.seed);
      this.original = hydration.original;
      this.sendState = hydration.sendState;
      // F2.5: la versión base del autosave es la que trae el detail; cada upsert devuelve una nueva.
      this.hydratedUpdatedAtUtc = detail.updatedAtUtc;
      this.store.resetAutosaveStatus();

      // Bytes del PDF original para que el editor renderice el documento real (no el de muestra).
      const url = await firstValueFrom(this.store.getDownloadUrl(detail.originalFileId));
      const blob = await this.fetchPdfBlob(url);
      this.setDocument({
        id: detail.originalFileId,
        name: `${detail.title}.pdf`,
        kind: 'pdf',
        size: '',
        date: '',
        blob,
        fileId: detail.originalFileId,
      });

      this.currentStep.set(3);
    } catch (err) {
      console.error('[signature] draft hydration failed', err);
      this.hydrateError.set('The draft could not be loaded. Close and try again.');
    } finally {
      this.hydrating.set(false);
    }
  }

  /** Cliente elegido en el paso 1 (buscador o recientes): se sube a los recientes del directorio. */
  onClientPicked(customer: CustomerSummary): void {
    this.directory.addRecent(customer);
    this.selectedClient.set(customerToWizardClient(customer));
  }

  /** Descarga los bytes del PDF comprobando el status (antes un 403/404 se tomaba como PDF y fallaba en pdf.js). */
  private async fetchPdfBlob(url: string): Promise<Blob> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`PDF download failed (${res.status})`);
    }
    return res.blob();
  }

  /** Fija el documento elegido y el que renderiza el editor (restaurar/rehidratar/confirmar reemplazo). */
  private setDocument(doc: WizardDocument | null, keepFields = false): void {
    this.keepFieldsOnDocumentChange.set(keepFields);
    this.selectedDocument.set(doc);
    this.editorDocument.set(doc);
  }

  onDocumentSelected(doc: WizardDocument): void {
    const current = this.editorDocument();
    // El mismo archivo otra vez (p. ej. re-elegido desde la biblioteca): no se re-renderiza ni se tocan campos.
    if (current && current.id === doc.id) {
      this.selectedDocument.set(current);
      return;
    }
    const placed = this.editor?.fields().length ?? 0;
    // Re-elegir el PDF con campos ya colocados: se confirma antes (y se ofrece conservarlos).
    if (current && current.id !== doc.id && placed > 0) {
      this.keepFieldsChoice.set(this.canKeepFieldsFor(doc));
      this.pendingDocument.set(doc);
      return;
    }
    this.acceptDocument(doc, false);
  }

  private acceptDocument(doc: WizardDocument, keepFields: boolean): void {
    this.setDocument(doc, keepFields);
    if (!this.title().trim()) {
      this.title.set(doc.name.replace(/\.pdf$/i, ''));
    }
  }

  onDocumentCleared(): void {
    this.selectedDocument.set(null);
    // Con campos colocados el editor conserva el documento actual hasta que se confirme el nuevo.
    if ((this.editor?.fields().length ?? 0) === 0) {
      this.editorDocument.set(null);
    }
  }

  /** Nº de páginas del documento actual en el editor (para el diálogo de reemplazo). */
  currentPageCount(): number {
    return this.editor?.pages().length ?? 0;
  }

  /** Se puede ofrecer "conservar campos" si el nuevo tiene las mismas páginas (o no se sabe aún). */
  canKeepFieldsFor(doc: WizardDocument | null): boolean {
    if (!doc) {
      return false;
    }
    return doc.pageCount == null || doc.pageCount === this.currentPageCount();
  }

  confirmDocumentSwap(): void {
    const doc = this.pendingDocument();
    if (!doc) {
      return;
    }
    const keep = this.keepFieldsChoice() && this.canKeepFieldsFor(doc);
    this.pendingDocument.set(null);
    this.acceptDocument(doc, keep);
  }

  /** "Keep current document": se vuelve a seleccionar el que ya tiene los campos. */
  cancelDocumentSwap(): void {
    this.pendingDocument.set(null);
    this.selectedDocument.set(this.editorDocument());
  }

  next(): void {
    if (!this.canProceed()) {
      return;
    }
    // Al salir del paso 1 se (re)carga el lote de browse de `store.customers()`: lo usa el
    // buscador de firmantes extra del editor (paso 3).
    if (this.currentStep() === 1) {
      this.store.queryCustomers('');
    }
    // Un firmante por SMS/WhatsApp SIN teléfono no puede recibir el OTP → bloquea avanzar.
    if (this.currentStep() === 3 && (this.editor?.signersMissingPhone().length ?? 0) > 0) {
      this.toast.error('Add a phone number for every SMS/WhatsApp signer to continue.');
      return;
    }
    // Identidad 8879 a medias/mal (uno de PTIN/nombre sin el otro) → bloquea avanzar (el backend la rechazaría).
    // Expande el panel del preparador por si estaba plegado: si no, el error inline ni se renderiza.
    if (this.currentStep() === 3 && this.editor?.preparerInfoInvalid()) {
      this.editor?.preparerOpen.set(true);
      this.toast.error('Complete the preparer details (Form 8879): enter both name and PTIN/EFIN, or clear both.');
      return;
    }
    // Al salir del editor se congela el estado para el resumen del paso 4 y el POST.
    if (this.currentStep() === 3) {
      this.signersSnapshot.set(this.editor?.getSigners() ?? []);
      this.fieldsSnapshot.set(this.editor?.getFields() ?? []);
      this.normalizedFieldsSnapshot.set(this.editor?.buildNormalizedFields() ?? []);
      this.preparerFieldsSnapshot.set(this.editor?.buildPreparerFields() ?? []);
      this.preparerSignatureFileIdSnapshot.set(this.editor?.getPreparerSignatureFileId() ?? null);
      this.preparerInfoSnapshot.set(this.editor?.getPreparerInfo() ?? null);
      this.rulesSnapshot.set(this.editor?.getRules() ?? null);
    }
    this.currentStep.update(step => Math.min(4, step + 1) as WizardStep);
  }

  back(): void {
    this.currentStep.update(step => Math.max(1, step - 1) as WizardStep);
  }

  /** El stepper permite volver a cualquier paso ya completado (nunca saltar adelante). */
  goToStep(step: WizardStep): void {
    if (step < this.currentStep()) {
      this.currentStep.set(step);
    }
  }

  /**
   * Escape cierra el wizard SOLO si nada más lo reclama: un modal abierto (Add signer, confirmaciones),
   * el foco en un campo editable, o algo abierto en el editor (menú, panel, selección) tienen prioridad.
   * Y si hay trabajo sin guardar, se pide confirmación igual que con "Back to list"/"Cancel".
   */
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (event.defaultPrevented || this.confirmCloseOpen() || this.pendingDocument()) {
      return;
    }
    if (typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]')) {
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    if (this.currentStep() === 3 && this.editor?.handleEscape()) {
      return;
    }
    this.close();
  }

  /** "Back to list" / "Cancel" / Escape: pregunta antes de descartar trabajo sin guardar. */
  close(): void {
    if (this.isSending() || this.savingDraft()) {
      return;
    }
    if (this.hasUnsavedWork()) {
      this.confirmCloseOpen.set(true);
      return;
    }
    this.closed.emit();
  }

  confirmDiscard(): void {
    this.confirmCloseOpen.set(false);
    this.closed.emit();
  }

  /** Hay algo que se perdería al cerrar (crear: documento o cambios; continuar: cualquier edición). */
  hasUnsavedWork(): boolean {
    const editorDirty = this.editor?.dirty() ?? false;
    if (this.editingDraft()) {
      return this.metaDirty() || editorDirty;
    }
    return this.selectedDocument() !== null || this.editorDocument() !== null || editorDirty;
  }

  /** Cambios de metadata en Review (título, categoría, fecha, descripción). */
  markMetaDirty(): void {
    this.metaDirty.set(true);
  }

  /** Reglas editadas en Review: vuelven al MISMO signal del editor y al snapshot que usa buildDraft. */
  onRulesChange(rules: RequestRules): void {
    this.editor?.setRules(rules);
    this.rulesSnapshot.set(rules);
  }

  /** Permiso de entrega evaluado por el editor (signature.document.send), sin duplicar la lógica. */
  canDeliverDocs(): boolean {
    return this.editor?.canDeliverDocs() ?? false;
  }

  /** "Go to signer" desde Review: vuelve al editor con ese firmante activo. */
  goToSigner(signerId: string): void {
    this.currentStep.set(3);
    this.editor?.focusSigner(signerId);
  }

  send(): void {
    if (this.isSending()) {
      return;
    }
    // La validación del PIN vive en Send (las reglas se editan en Review).
    if (isSigningPinInvalid(this.rulesSnapshot())) {
      this.toast.error('Enter a 4–10 digit Signing PIN, or clear it to send.');
      return;
    }
    if (!this.canSend()) {
      return;
    }
    void this.runSend();
  }

  /** F3 — Abre/cierra el picker inline del Schedule send. */
  toggleSchedulePicker(): void {
    if (this.isSending() || this.scheduling()) {
      return;
    }
    this.scheduleError.set('');
    this.scheduleOpen.update(v => !v);
  }

  /**
   * F3 — Programa el envío a futuro. Flujo: materializar/actualizar el draft (como "Save as draft")
   * y luego llamar `POST /schedule`. El input es datetime-local (TZ del navegador); lo convertimos a
   * ISO UTC con `new Date(local).toISOString()`.
   */
  scheduleSend(): void {
    if (!this.canSend() || this.scheduling() || this.isSending()) {
      return;
    }
    if (isSigningPinInvalid(this.rulesSnapshot())) {
      this.toast.error('Enter a 4–10 digit Signing PIN, or clear it to schedule.');
      return;
    }
    const local = this.scheduleAtLocal().trim();
    if (!local) {
      this.scheduleError.set('Pick a date and time.');
      return;
    }
    const parsed = new Date(local);
    if (Number.isNaN(parsed.getTime())) {
      this.scheduleError.set('Invalid date/time.');
      return;
    }
    if (parsed.getTime() <= Date.now()) {
      this.scheduleError.set('The time must be in the future.');
      return;
    }
    void this.runSchedule(parsed.toISOString());
  }

  /** Mapea el status del detail a un mensaje claro para el usuario cuando `schedule` responde 409. */
  private describeNotSchedulableStatus(status: ApiSignatureRequestStatus | undefined): string {
    switch (status) {
      case 'InProgress':
        return 'This request was already sent. You can\'t schedule it anymore.';
      case 'Completed':
        return 'This request is already completed.';
      case 'Rejected':
        return 'This request was rejected.';
      case 'Canceled':
        return 'This request was canceled.';
      case 'Expired':
        return 'This request has expired.';
      default:
        return 'This request can\'t be scheduled in its current state.';
    }
  }

  private async runSchedule(utcIso: string): Promise<void> {
    // En Review los snapshots vienen de los pasos previos, pero volver a congelar es barato y seguro.
    if (this.editor) {
      this.signersSnapshot.set(this.editor.getSigners());
      this.fieldsSnapshot.set(this.editor.getFields());
      this.normalizedFieldsSnapshot.set(this.editor.buildNormalizedFields());
      this.preparerFieldsSnapshot.set(this.editor.buildPreparerFields());
      this.preparerSignatureFileIdSnapshot.set(this.editor.getPreparerSignatureFileId());
      this.preparerInfoSnapshot.set(this.editor.getPreparerInfo());
      this.rulesSnapshot.set(this.editor.getRules());
    }
    const draft = this.buildDraft();
    if (!draft) {
      return;
    }
    this.scheduling.set(true);
    this.scheduleError.set('');
    try {
      // Persistir el borrador primero (crea o actualiza vía diff), luego programar. No hacemos
      // guard preventivo del status aquí: el backend acepta Draft/Ready/Scheduled; si está en
      // cualquier otro estado, el 409 que viene abajo se traduce al mensaje humano real.
      this.sendState = this.original
        ? await this.store.commitEditedDraft(draft, this.sendState, this.original, false)
        : await this.store.saveDraft(draft, this.sendState);
      const requestId = this.sendState.requestId;
      if (!requestId) {
        throw new Error('The request could not be prepared to schedule.');
      }
      await firstValueFrom(this.store.scheduleSendRequest(requestId, utcIso));
      clearDraftSnapshot();
      this.scheduling.set(false);
      this.scheduleOpen.set(false);
      this.scheduleAtLocal.set('');
      this.toast.success('Scheduled — the request will be sent at the chosen time');
      this.sent.emit();
    } catch (err) {
      this.scheduling.set(false);
      const apiError = toApiError(err);
      if (apiError.code === 'Signature.Request.NotSchedulable' && this.sendState.requestId) {
        // Resolvemos el status real para explicar POR QUÉ no se puede programar.
        try {
          const current = await firstValueFrom(this.store.getDetail(this.sendState.requestId));
          this.scheduleError.set(this.describeNotSchedulableStatus(current.status));
        } catch {
          this.scheduleError.set(apiError.message || 'The request could not be scheduled.');
        }
      } else {
        this.scheduleError.set(apiError.message || 'The request could not be scheduled.');
      }
    }
  }

  /** Guarda el borrador sin enviarlo. Reusa `sendState`: si luego se envía, no se duplica nada. */
  saveAsDraft(): void {
    if (!this.canSaveDraft() || this.savingDraft() || this.isSending()) {
      return;
    }
    // Defensa extra (el botón ya está deshabilitado): con el render fallido no se exporta nada.
    if (this.editor && !this.editor.safeToExport()) {
      this.toast.error(this.editor.exportBlockedReason() || 'Wait for the document to finish loading.');
      return;
    }
    // Congela lo que haya en el editor (que está montado desde el paso 1 y ya tiene al firmante
    // cliente) sin importar el paso actual — si no, guardar desde el paso 2 dejaba el borrador SIN
    // firmantes y "Continue editing" no mostraba el cliente.
    if (this.editor) {
      this.signersSnapshot.set(this.editor.getSigners());
      this.fieldsSnapshot.set(this.editor.getFields());
      this.normalizedFieldsSnapshot.set(this.editor.buildNormalizedFields());
      this.preparerFieldsSnapshot.set(this.editor.buildPreparerFields());
      this.preparerSignatureFileIdSnapshot.set(this.editor.getPreparerSignatureFileId());
      this.preparerInfoSnapshot.set(this.editor.getPreparerInfo());
      this.rulesSnapshot.set(this.editor.getRules());
    }
    const draft = this.buildDraft();
    if (!draft) {
      return;
    }
    void this.runSaveDraft(draft);
  }

  private async runSaveDraft(draft: WizardRequestDraft): Promise<void> {
    this.savingDraft.set(true);
    this.sendError.set('');
    try {
      // Continuar (rehidratado) usa el commit con diff; crear nuevo usa saveDraft.
      this.sendState = this.original
        ? await this.store.commitEditedDraft(draft, this.sendState, this.original, false)
        : await this.store.saveDraft(draft, this.sendState);
      clearDraftSnapshot();
      this.savingDraft.set(false);
      this.saved.emit();
    } catch (err) {
      this.savingDraft.set(false);
      this.sendError.set(err instanceof Error ? err.message : 'The draft could not be saved.');
    }
  }

  private async runSend(): Promise<void> {
    const draft = this.buildDraft();
    if (!draft) {
      return;
    }
    this.sendError.set('');
    this.sendPhase.set('paper');
    const onPhase = (phase: 'creating' | 'sending'): void =>
      this.sendPhase.set(phase === 'creating' ? 'paper' : 'signing');
    try {
      // Continuar (rehidratado) usa el commit con diff; crear nuevo usa sendWizard.
      this.sendState = this.original
        ? await this.store.commitEditedDraft(draft, this.sendState, this.original, true, onPhase)
        : await this.store.sendWizard(draft, this.sendState, onPhase);
      clearDraftSnapshot();
      this.sendPhase.set('done');
      await this.delay(800);
      this.sendPhase.set('idle');
      this.sent.emit();
    } catch (err) {
      this.sendPhase.set('idle');
      this.sendError.set(err instanceof Error ? err.message : 'The request could not be sent. Please retry.');
    }
  }

  /**
   * F2.5: cada vez que el editor consolida un cambio, armamos el UpsertDraftBody en vivo y lo
   * mandamos al pipeline debounced del store. Guardas:
   *  - flag `signatureAutosaveEnabled` off → no hace nada.
   *  - sin requestId (todavía no se materializó el draft) → no autoguarda; el primer "Save as draft"
   *    manual sigue siendo el disparador de creación. (El "first PlaceField crea la request"
   *    automático es una mejora incremental.)
   *  - editor no listo (`safeToExport` false, PDF cargando) → silencio.
   */
  onEditorStateChanged(): void {
    if (!this.store.autosaveEnabled) {
      return;
    }
    const requestId = this.sendState.requestId;
    if (!requestId) {
      return;
    }
    const editor = this.editorRef();
    if (!editor || !editor.safeToExport()) {
      return;
    }
    const body = this.buildAutosaveBody(editor);
    if (!body) {
      return;
    }
    this.store.scheduleAutosave(requestId, body);
  }

  /** Snapshot del editor + metadata del wizard en el shape que el endpoint `PUT /requests/{id}/draft` espera. */
  private buildAutosaveBody(editor: SignaturePdfEditorComponent): UpsertDraftBody | null {
    const client = this.selectedClient();
    const doc = this.selectedDocument();
    if (!client || !doc?.fileId) {
      return null;
    }
    const rules = editor.getRules();
    const editorSigners = editor.getSigners();
    const normalized = editor.buildNormalizedFields();

    // Signers conservan su Id del backend cuando ya se posteó (sendState.signerIdByLocal); los nuevos
    // llevan Id null para que el handler los cree y les asigne un Guid.
    const signers: UpsertDraftSigner[] = editorSigners.map(s => ({
      id: this.sendState.signerIdByLocal[s.id] ?? null,
      email: s.email,
      fullName: s.name,
      phoneNumber: s.phone.trim() || null,
      language: s.language,
      verificationMethod: channelToVerificationMethod(s.channel) ?? null,
    }));

    // MVP: los fields van sin Id → el handler re-sincroniza fields en cada autosave (borra lo que
    // ya no está, crea los nuevos). Correcto e idempotente; optimización por diff queda para después.
    const signerIndexById = new Map<string, number>();
    editorSigners.forEach((s, i) => signerIndexById.set(s.id, i));
    const fields: UpsertDraftField[] = [];
    for (const f of normalized) {
      const idx = signerIndexById.get(f.signerLocalId);
      if (idx === undefined) {
        continue; // field huérfano (su signer local ya no existe) — se omite
      }
      fields.push({
        id: null,
        signerIndex: idx,
        kind: fieldTypeToKind(f.type),
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        label: f.label ?? null,
        isRequired: true,
      });
    }

    return {
      expectedUpdatedAtUtc: this.store.lastSavedAtUtc() ?? this.hydratedUpdatedAtUtc,
      title: this.title().trim() || 'Untitled',
      description: this.notes().trim() || null,
      category: this.category(),
      tokenExpirationHours: this.tokenExpirationHours(),
      sendSignedDocumentToSigners: rules.sendSignedDocument,
      sendCertificateToSigners: rules.sendCertificate && rules.certificate,
      autoRemindersEnabled: rules.autoReminder,
      reminderIntervalHours: rules.reminderIntervalHours,
      signers,
      fields,
    };
  }

  private buildDraft(): WizardRequestDraft | null {
    const client = this.selectedClient();
    const doc = this.selectedDocument();
    if (!client || !doc?.fileId) {
      return null;
    }
    const rules = this.rulesSnapshot();
    return {
      title: this.title().trim(),
      description: this.notes().trim() || null,
      category: this.category(),
      originalFileId: doc.fileId,
      tokenExpirationHours: this.tokenExpirationHours(),
      requiresSequentialSigning: rules?.sequential ?? true,
      requiresConsent: true,
      generateCertificate: rules?.certificate ?? true,
      sendSignedDocumentToSigners: rules?.sendSignedDocument ?? true,
      sendCertificateToSigners: (rules?.sendCertificate ?? false) && (rules?.certificate ?? true),
      autoRemindersEnabled: rules?.autoReminder ?? true,
      reminderIntervalHours: rules?.reminderIntervalHours ?? 48,
      signingPin: rules?.signingPin?.trim() || null,
      signers: this.signersSnapshot().map(signer => ({
        localId: signer.id,
        fullName: signer.name,
        email: signer.email,
        language: signer.language,
        phone: signer.phone.trim() || null,
        verificationMethod: channelToVerificationMethod(signer.channel),
      })),
      fields: this.normalizedFieldsSnapshot().map(field => ({
        localId: field.localId,
        signerLocalId: field.signerLocalId,
        kind: fieldTypeToKind(field.type),
        page: field.page,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        isRequired: true,
        label: field.label ?? null,
      })),
      preparerFields: this.preparerFieldsSnapshot().map(field => ({
        localId: field.localId,
        signerLocalId: field.signerLocalId,
        kind: fieldTypeToKind(field.type),
        page: field.page,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        isRequired: true,
        label: field.label ?? null,
      })),
      preparerSignatureFileId: this.preparerSignatureFileIdSnapshot(),
      preparerInfo: this.preparerInfoSnapshot(),
    };
  }

  /** Due date → horas de expiración del token (rango 1..720 del dominio; sin fecha = 7 días). */
  private tokenExpirationHours(): number {
    const due = this.dueDate();
    if (!due) {
      return TOKEN_EXPIRATION_DEFAULT_HOURS;
    }
    const endOfDay = new Date(`${due}T23:59:59`);
    const hours = Math.ceil((endOfDay.getTime() - Date.now()) / 3_600_000);
    return Math.min(Math.max(hours, TOKEN_EXPIRATION_MIN_HOURS), TOKEN_EXPIRATION_MAX_HOURS);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/** El foco está en algo que usa Escape por sí mismo (input, textarea, select, contenteditable). */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') {
    return false;
  }
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}
