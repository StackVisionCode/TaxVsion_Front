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
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SignatureWizardClientStepComponent } from '../signature-wizard-client-step/signature-wizard-client-step.component';
import { SignatureClientPickerComponent } from '../signature-client-picker/signature-client-picker.component';
import { SignatureWizardDocumentStepComponent } from '../signature-wizard-document-step/signature-wizard-document-step.component';
import { pushRecentClient, readRecentClients } from '../../utils/recent-clients.util';
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
  SetPreparerBody,
  SignatureCategory,
  TOKEN_EXPIRATION_DEFAULT_HOURS,
  TOKEN_EXPIRATION_MAX_HOURS,
  TOKEN_EXPIRATION_MIN_HOURS,
  channelToVerificationMethod,
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
import { ToastService } from '../../../../shared/ui/toast/toast.service';

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
    SignatureClientPickerComponent,
    SignatureWizardDocumentStepComponent,
    SignatureWizardReviewStepComponent,
    SignaturePdfEditorComponent,
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

  @ViewChild('editor') private editor?: SignaturePdfEditorComponent;

  readonly store = inject(SignatureStore);
  private readonly toast = inject(ToastService);

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
  /** Modal de búsqueda de cliente (vive en la raíz del panel, fuera de la tarjeta animada). */
  readonly clientPickerOpen = signal(false);
  /** Últimos clientes elegidos, para el acceso rápido del paso 1. */
  readonly recentClients = signal<WizardClient[]>(readRecentClients());
  readonly selectedDocument = signal<WizardDocument | null>(null);
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
  readonly sendError = signal('');

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
        return this.fieldCount() > 0;
      default:
        return true;
    }
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
      this.normalizedFieldsSnapshot().some(f => f.type === 'signature' || f.type === 'initials')
    );
  });

  /** Guardar como borrador exige cliente, documento subido y un título válido; el resto es opcional. */
  readonly canSaveDraft = computed(() => {
    const titleLength = this.title().trim().length;
    return (
      this.selectedClient() !== null &&
      !!this.selectedDocument()?.fileId &&
      titleLength >= 3 &&
      titleLength <= 300
    );
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
    if (this.editingDraft() || !this.editor) {
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
      const blob = await (await fetch(url)).blob();
      this.selectedDocument.set({
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
      this.hydrateError.set(err instanceof Error ? err.message : 'Your unsaved work could not be restored.');
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

      // Bytes del PDF original para que el editor renderice el documento real (no el de muestra).
      const url = await firstValueFrom(this.store.getDownloadUrl(detail.originalFileId));
      const blob = await (await fetch(url)).blob();
      this.selectedDocument.set({
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
      this.hydrateError.set(err instanceof Error ? err.message : 'The draft could not be loaded.');
    } finally {
      this.hydrating.set(false);
    }
  }

  onClientSelected(client: WizardClient): void {
    this.selectedClient.set(client);
    this.recentClients.set(pushRecentClient(this.recentClients(), client));
  }

  /** El picker devolvió un cliente: se elige y se cierra el modal. */
  onClientPicked(client: WizardClient): void {
    this.onClientSelected(client);
    this.clientPickerOpen.set(false);
  }

  onDocumentSelected(doc: WizardDocument): void {
    this.selectedDocument.set(doc);
    if (!this.title().trim()) {
      this.title.set(doc.name.replace(/\.pdf$/i, ''));
    }
  }

  onDocumentCleared(): void {
    this.selectedDocument.set(null);
  }

  next(): void {
    if (!this.canProceed()) {
      return;
    }
    // El buscador del paso 1 es typeahead server-side y deja `store.customers()` con las
    // últimas coincidencias; al avanzar restauramos el lote completo para que el <select>
    // de firmantes extra del editor (paso 3) no quede reducido a esa búsqueda.
    if (this.currentStep() === 1) {
      this.store.queryCustomers('');
    }
    // Un PIN de firma escrito pero incompleto (1–3 dígitos) bloquea avanzar: el backend exige 4–10.
    // El botón Next está habilitado (hay campos): sin un toast, el clic parece "no hacer nada".
    if (this.currentStep() === 3 && this.editor?.signingPinInvalid()) {
      this.toast.error('Enter a 4–10 digit Signing PIN, or clear it to continue.');
      return;
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

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  close(): void {
    if (this.isSending()) {
      return;
    }
    this.closed.emit();
  }

  send(): void {
    if (!this.canSend() || this.isSending()) {
      return;
    }
    void this.runSend();
  }

  /** Guarda el borrador sin enviarlo. Reusa `sendState`: si luego se envía, no se duplica nada. */
  saveAsDraft(): void {
    if (!this.canSaveDraft() || this.savingDraft() || this.isSending()) {
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
