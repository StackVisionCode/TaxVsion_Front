import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Output,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Signer, SignatureRequest } from '../signature-table/signature-table.component';
import { SignatureWizardClientStepComponent } from '../signature-wizard-client-step/signature-wizard-client-step.component';
import { SignatureWizardDocumentStepComponent } from '../signature-wizard-document-step/signature-wizard-document-step.component';
import { SignatureWizardReviewStepComponent } from '../signature-wizard-review-step/signature-wizard-review-step.component';
import { SignaturePdfEditorComponent } from '../signature-pdf-editor/signature-pdf-editor.component';
import { EditorSigner, PlacedField, RequestRules, WizardClient, WizardDocument } from './signature-wizard.model';
import { initialsOf } from './signature-wizard.mock';

type WizardStep = 1 | 2 | 3 | 4;

/** Fases de la coreografía de envío: el papel se crea → se firma → sale. */
type SendPhase = 'idle' | 'paper' | 'signing' | 'done';

/**
 * Wizard de "New Signature Request" (adaptado del flujo del CRM: cliente →
 * documento → editor de campos sobre el PDF → review → enviar). Es un takeover
 * in-page (mismo patrón que la vista previa): el padre lo monta con *ngIf
 * reemplazando la lista, dentro del shell (sidebar + navbar siguen visibles).
 * Cada paso es un sub-componente; el editor (paso 3) queda montado (oculto en
 * los demás pasos) para preservar los campos al navegar, y al pasar 3→4 se
 * snapshotean firmantes/campos para el resumen. Sin backend: `send()` arma el
 * `SignatureRequest` y lo emite (el POST /signature/requests real queda como
 * punto de integración futuro).
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
  @Output() sent = new EventEmitter<SignatureRequest>();

  @ViewChild('editor') private editor?: SignaturePdfEditorComponent;

  readonly currentStep = signal<WizardStep>(1);
  readonly selectedClient = signal<WizardClient | null>(null);
  readonly selectedDocument = signal<WizardDocument | null>(null);
  readonly dueDate = signal('');
  readonly notes = signal('');
  readonly fieldCount = signal(0);

  /** Snapshots tomados al pasar 3→4 (el editor sigue montado para que Back preserve). */
  readonly signersSnapshot = signal<EditorSigner[]>([]);
  readonly fieldsSnapshot = signal<PlacedField[]>([]);
  readonly rulesSnapshot = signal<RequestRules | null>(null);

  /** Coreografía de envío (overlay a pantalla completa). */
  readonly sendPhase = signal<SendPhase>('idle');
  readonly isSending = computed(() => this.sendPhase() !== 'idle');
  readonly sendCaption = computed(() => {
    switch (this.sendPhase()) {
      case 'paper':
        return 'Creating document…';
      case 'signing':
        return 'Signing…';
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
    'Pick or upload the document to sign',
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
        return this.selectedDocument() !== null;
      case 3:
        return this.fieldCount() > 0;
      default:
        return true;
    }
  });

  readonly canSend = computed(
    () =>
      this.selectedClient() !== null &&
      this.selectedDocument() !== null &&
      this.fieldsSnapshot().length > 0,
  );

  onClientSelected(client: WizardClient): void {
    this.selectedClient.set(client);
  }

  onDocumentSelected(doc: WizardDocument): void {
    this.selectedDocument.set(doc);
  }

  next(): void {
    if (!this.canProceed()) {
      return;
    }
    // Al salir del editor se congela el estado para el resumen del paso 4.
    if (this.currentStep() === 3) {
      this.signersSnapshot.set(this.editor?.getSigners() ?? []);
      this.fieldsSnapshot.set(this.editor?.getFields() ?? []);
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
    const client = this.selectedClient();
    const doc = this.selectedDocument();
    if (!this.canSend() || !client || !doc || this.isSending()) {
      return;
    }

    const signers: Signer[] = this.signersSnapshot().map(signer => ({
      name: signer.name,
      initials: initialsOf(signer.name),
      email: signer.email,
      color: signer.color,
      status: 'pending' as const,
      signedAt: null,
      channel: signer.channel,
    }));

    const pdfPayload = this.editor?.buildPdfPayload() ?? [];

    const today = new Date().toISOString().slice(0, 10);
    const request: SignatureRequest = {
      id: `signature-${Date.now()}`,
      documentName: doc.name,
      client: client.displayName,
      clientId: client.id,
      signers,
      status: 'pending',
      sentDate: today,
      dueDate: this.dueDate() || today,
      completedDate: null,
      notes: this.notes().trim(),
      signatureFields: this.fieldsSnapshot(),
      rules: this.rulesSnapshot() ?? undefined,
    };

    // Punto de integración futuro con el backend: POST /signature/requests.
    console.debug('[signature] POST /signature/requests', { request, pdfPayload });

    void this.playSendSequence(request);
  }

  /** Coreografía de envío: el papel se crea (líneas), se firma (trazo) y sale. */
  private async playSendSequence(request: SignatureRequest): Promise<void> {
    this.sendPhase.set('paper');
    await this.delay(1000);
    this.sendPhase.set('signing');
    await this.delay(1500);
    this.sendPhase.set('done');
    await this.delay(800);
    this.sendPhase.set('idle');
    this.sent.emit(request);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
