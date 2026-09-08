import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SignatureWizardClientStepComponent } from '../signature-wizard-client-step/signature-wizard-client-step.component';
import { SignatureWizardDocumentStepComponent } from '../signature-wizard-document-step/signature-wizard-document-step.component';
import { SignatureWizardReviewStepComponent } from '../signature-wizard-review-step/signature-wizard-review-step.component';
import { NormalizedPlacedField, SignaturePdfEditorComponent } from '../signature-pdf-editor/signature-pdf-editor.component';
import { EditorSigner, PlacedField, RequestRules, WizardClient, WizardDocument } from './signature-wizard.model';
import {
  SignatureCategory,
  TOKEN_EXPIRATION_DEFAULT_HOURS,
  TOKEN_EXPIRATION_MAX_HOURS,
  TOKEN_EXPIRATION_MIN_HOURS,
  channelToVerificationMethod,
  fieldTypeToKind,
} from '../../data-access/signature.model';
import {
  SignatureStore,
  WizardRequestDraft,
  WizardSendState,
  emptySendState,
} from '../../data-access/signature.store';

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
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-request-panel.component.html',
  styleUrl: './signature-request-panel.component.css',
})
export class SignatureRequestPanelComponent {
  @Output() closed = new EventEmitter<void>();
  /** El backend ya mandó los emails (POST send → 202): el padre solo refresca y cierra. */
  @Output() sent = new EventEmitter<void>();

  @ViewChild('editor') private editor?: SignaturePdfEditorComponent;

  readonly store = inject(SignatureStore);

  readonly currentStep = signal<WizardStep>(1);
  readonly selectedClient = signal<WizardClient | null>(null);
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
  readonly rulesSnapshot = signal<RequestRules | null>(null);

  /** Progreso del envío multi-paso; sobrevive a fallos parciales para reintentar sin duplicar. */
  private sendState: WizardSendState = emptySendState();
  readonly sendError = signal('');

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

  onClientSelected(client: WizardClient): void {
    this.selectedClient.set(client);
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
    // Al salir del editor se congela el estado para el resumen del paso 4 y el POST.
    if (this.currentStep() === 3) {
      this.signersSnapshot.set(this.editor?.getSigners() ?? []);
      this.fieldsSnapshot.set(this.editor?.getFields() ?? []);
      this.normalizedFieldsSnapshot.set(this.editor?.buildNormalizedFields() ?? []);
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

  private async runSend(): Promise<void> {
    const draft = this.buildDraft();
    if (!draft) {
      return;
    }
    this.sendError.set('');
    this.sendPhase.set('paper');
    try {
      this.sendState = await this.store.sendWizard(draft, this.sendState, phase => {
        this.sendPhase.set(phase === 'creating' ? 'paper' : 'signing');
      });
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
      })),
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
