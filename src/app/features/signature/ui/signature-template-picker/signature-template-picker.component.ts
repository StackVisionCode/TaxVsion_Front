import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { SignatureDocumentLibraryComponent } from '../signature-document-library/signature-document-library.component';
import { toApiError } from '@core/models/api-error.model';
import { FileResponse } from '@core/cloud-storage/cloud-storage.model';
import { SignatureStore } from '../../data-access/signature.store';
import { CustomerSummary } from '@core/customers/customer-summary.model';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { injectEmbeddedCustomer } from '@core/customers/embedded-customer';
import { CustomerPickerComponent } from '@shared/ui/customer-picker/customer-picker.component';
import {
  SignatureRequestDetail,
  SignatureTemplateDetail,
  SignerVerificationMethod,
  SlotBinding,
  TemplateSummary,
} from '../../data-access/signature.model';

/** Lo que el usuario teclea para cada rol del molde. */
interface SlotDraft {
  slotOrder: number;
  role: string;
  email: string;
  fullName: string;
  phone: string;
  /** Método OTP que exige el rol (del molde); decide si el teléfono es obligatorio. */
  verificationMethod?: SignerVerificationMethod | null;
  /** 'client' = elegir del directorio; 'manual' = tipear datos externos. Elección independiente por slot. */
  source: 'client' | 'manual';
}

/** Origen del documento: el documento base de la plantilla (P7), subir uno nuevo, o reusar un PDF de la oficina. */
type DocSource = 'template' | 'upload' | 'library';

interface TemplateDocumentDraft {
  templateDocumentId: string;
  title: string;
  source: DocSource;
  file: File | null;
  libraryFile: FileResponse | null;
  error: string;
}

const MAX_PDF_BYTES = 25 * 1024 * 1024;

/**
 * Crear una solicitud a partir de una plantilla.
 *
 * Una plantilla guarda el "molde" repetitivo (categoría, roles de firmante y
 * layout de campos, más los settings de secuencial/consentimiento/certificado);
 * lo único que cambia entre clientes es el documento y quién firma. Por eso
 * este flujo pide exactamente eso: el PDF y un firmante por rol.
 *
 * El backend tiene el feature completo pero el wizard nunca lo llamaba: armaba
 * la solicitud fresca cada vez.
 */
@Component({
  selector: 'app-signature-template-picker',
  imports: [CommonModule, FormsModule, ModalComponent, SignatureDocumentLibraryComponent, CustomerPickerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-template-picker.component.html',
  styleUrl: './signature-template-picker.component.css',
})
export class SignatureTemplatePickerComponent {
  private readonly store = inject(SignatureStore);
  private readonly directory = inject(CustomerDirectoryStore);
  /** Embebido en el perfil de un cliente: el primer rol se prellena con ese cliente (editable). */
  private readonly embeddedCustomer = injectEmbeddedCustomer();

  @Input() set isOpen(value: boolean) {
    this.open.set(value);
    if (value) {
      this.reset();
      this.store.loadTemplates();
    }
  }
  @Output() closed = new EventEmitter<void>();
  /**
   * Solicitud creada. `sent` = si además se envió a los firmantes en el acto (lo normal); `false`
   * si el documento seguía en escaneo y quedó como borrador para enviar con el botón.
   */
  @Output() created = new EventEmitter<{ detail: SignatureRequestDetail; sent: boolean }>();

  readonly open = signal(false);

  /** Fase del create+send para el overlay de carga. */
  readonly phase = signal<'idle' | 'creating' | 'preparing' | 'sending'>('idle');
  readonly phaseLabel = computed(() => {
    switch (this.phase()) {
      case 'creating':
        return 'Uploading and preparing the documents…';
      case 'preparing':
        return 'Waiting for the document to clear its security scan…';
      case 'sending':
        return 'Sending to signers…';
      default:
        return '';
    }
  });

  readonly templates = this.store.templates;
  readonly templatesLoading = this.store.templatesLoading;
  readonly templatesError = this.store.templatesError;

  /** null = todavía se está eligiendo el molde. */
  readonly selected = signal<SignatureTemplateDetail | null>(null);
  readonly loadingDetail = signal(false);
  readonly slots = signal<SlotDraft[]>([]);
  readonly description = signal('');
  readonly documents = signal<TemplateDocumentDraft[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');

  readonly hasDocuments = computed(
    () =>
      this.documents().length > 0 &&
      this.documents().every(document =>
        document.source === 'template'
          ? true
          : document.source === 'upload'
            ? !!document.file
            : !!document.libraryFile,
      ),
  );

  /** Hace falta el PDF y un firmante completo por cada rol; teléfono si el rol exige SMS/WhatsApp. */
  readonly canCreate = computed(
    () =>
      this.hasDocuments() &&
      this.slots().length > 0 &&
      this.slots().every(
        slot =>
          slot.email.trim().length > 0 &&
          slot.fullName.trim().length > 0 &&
          (!this.slotNeedsPhone(slot) || slot.phone.trim().length >= 7),
      ),
  );

  /** true si el rol exige OTP por SMS/WhatsApp (necesita teléfono para entregar el código). */
  slotNeedsPhone(slot: SlotDraft): boolean {
    return slot.verificationMethod === 'SmsOtp' || slot.verificationMethod === 'WhatsAppOtp';
  }

  /** Etiqueta del canal OTP del rol (para la ayuda del campo teléfono). */
  slotChannelLabel(slot: SlotDraft): string {
    return slot.verificationMethod === 'WhatsAppOtp' ? 'WhatsApp' : 'SMS';
  }

  close(): void {
    if (this.busy()) {
      return;
    }
    this.closed.emit();
  }

  private reset(): void {
    this.selected.set(null);
    this.slots.set([]);
    this.description.set('');
    this.documents.set([]);
    this.error.set('');
  }

  // ---------- Documento: subir vs librería ----------

  setDocSource(documentId: string, source: DocSource): void {
    this.documents.update(documents =>
      documents.map(document =>
        document.templateDocumentId === documentId
          ? {
              ...document,
              source,
              file: source === 'upload' ? document.file : null,
              libraryFile: source === 'library' ? document.libraryFile : null,
              error: '',
            }
          : document,
      ),
    );
  }

  onLibraryPicked(documentId: string, file: FileResponse): void {
    this.documents.update(documents =>
      documents.map(document =>
        document.templateDocumentId === documentId ? { ...document, libraryFile: file, error: '' } : document,
      ),
    );
  }

  documentDraft(documentId: string): TemplateDocumentDraft | null {
    return this.documents().find(document => document.templateDocumentId === documentId) ?? null;
  }

  // ---------- Buscador de cliente por slot ----------

  /** Cambia el modo del slot (sin tocar datos ya tipeados). Cliente ⇄ Manual. */
  setSlotSource(slotOrder: number, source: 'client' | 'manual'): void {
    this.updateSlot(slotOrder, { source });
  }

  pickClient(slotOrder: number, client: CustomerSummary | null): void {
    if (!client) {
      return;
    }
    // Autollena nombre/email y — clave para SMS/WhatsApp — el teléfono del cliente registrado.
    this.updateSlot(slotOrder, {
      fullName: client.displayName,
      email: client.primaryEmail,
      phone: client.primaryPhone ?? '',
    });
  }

  /** true si el slot está completo (nombre + email + teléfono si aplica). */
  slotReady(slot: SlotDraft): boolean {
    return (
      slot.email.trim().length > 0 &&
      slot.fullName.trim().length > 0 &&
      (!this.slotNeedsPhone(slot) || slot.phone.trim().length >= 7)
    );
  }

  // F7 — resumen de un slot como etiqueta cuando ya está asignado.
  slotSummaryName(slot: SlotDraft): string {
    return slot.fullName.trim() || slot.email.trim();
  }

  /** Al elegir un molde hay que traer su detalle: la lista no incluye los slots. */
  choose(template: TemplateSummary): void {
    this.loadingDetail.set(true);
    this.error.set('');
    this.store.getTemplate(template.id).subscribe({
      next: detail => {
        this.selected.set(detail);
        this.documents.set(
          [...detail.baseDocuments]
            .sort((a, b) => a.order - b.order)
            .map(document => ({
              templateDocumentId: document.id,
              title: document.title,
              source: 'template' as const,
              file: null,
              libraryFile: null,
              error: '',
            })),
        );
        this.slots.set(
          [...detail.slots]
            .sort((a, b) => a.order - b.order)
            .map(slot => ({
              slotOrder: slot.order,
              role: slot.role,
              email: '',
              fullName: '',
              phone: '',
              verificationMethod: slot.requiredVerificationMethod ?? null,
              // Default: elegir del directorio (lo más común en la oficina).
              source: 'client' as const,
            })),
        );
        this.loadingDetail.set(false);
        this.prefillEmbeddedCustomer(detail.id);
      },
      error: err => {
        this.error.set(toApiError(err).message);
        this.loadingDetail.set(false);
      },
    });
  }

  /** Prellena el slot 1 con el cliente embebido (si sigue abierta la misma plantilla y el slot está vacío). */
  private prefillEmbeddedCustomer(templateId: string): void {
    const customer = this.embeddedCustomer();
    const first = this.slots()[0];
    if (!customer || !first) {
      return;
    }
    this.directory.byId([customer.id]).subscribe({
      next: found => {
        const summary = found.get(customer.id);
        const slot = this.slots().find(s => s.slotOrder === first.slotOrder);
        if (summary && this.selected()?.id === templateId && slot && !slot.email && !slot.fullName) {
          this.pickClient(first.slotOrder, summary);
        }
      },
      // Best-effort: si falla, el usuario elige al cliente en el buscador como siempre.
      error: () => undefined,
    });
  }

  backToList(): void {
    this.selected.set(null);
    this.slots.set([]);
    this.error.set('');
  }

  updateSlot(slotOrder: number, patch: Partial<SlotDraft>): void {
    this.slots.update(list => list.map(slot => (slot.slotOrder === slotOrder ? { ...slot, ...patch } : slot)));
  }

  /** Mismo límite que el wizard: PDF y ≤25 MB (el preflight del backend lo repite). */
  onFileSelected(documentId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0] ?? null;
    input.value = '';
    if (!picked) {
      return;
    }
    if (picked.type !== 'application/pdf') {
      this.setDocumentError(documentId, 'Only PDF files can be sent for signature.');
      return;
    }
    if (picked.size > MAX_PDF_BYTES) {
      this.setDocumentError(documentId, 'That PDF is over the 25 MB limit.');
      return;
    }
    this.documents.update(documents =>
      documents.map(document =>
        document.templateDocumentId === documentId ? { ...document, file: picked, error: '' } : document,
      ),
    );
  }

  private setDocumentError(documentId: string, error: string): void {
    this.documents.update(documents =>
      documents.map(document =>
        document.templateDocumentId === documentId ? { ...document, file: null, error } : document,
      ),
    );
  }

  async create(): Promise<void> {
    const template = this.selected();
    if (!template || !this.canCreate() || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const bindings: SlotBinding[] = this.slots().map(slot => ({
      slotOrder: slot.slotOrder,
      email: slot.email.trim(),
      fullName: slot.fullName.trim(),
      phoneNumber: slot.phone.trim() || null,
    }));
    const note = this.description().trim() || null;

    // Una sola acción: crear + esperar a que el documento esté listo + enviar a los firmantes.
    // Librería reusa el fileId (rápido); upload valida+sube. El botón queda deshabilitado y el
    // modal no se puede cerrar mientras procesa (close() chequea busy).
    const documentSources = this.documents().map(document => ({
      templateDocumentId: document.templateDocumentId,
      title: document.title,
      source:
        document.source === 'template'
          ? ({ templateDoc: true } as const)
          : document.source === 'library'
            ? { fileId: document.libraryFile!.id }
            : { file: document.file! },
    }));

    try {
      const result = await this.store.instantiateMultiDocumentTemplateAndSend(
        template.id,
        documentSources,
        bindings,
        note,
        p => this.phase.set(p),
      );
      this.busy.set(false);
      this.phase.set('idle');
      this.created.emit(result);
    } catch (err) {
      this.busy.set(false);
      this.phase.set('idle');
      this.error.set(toApiError(err).message);
    }
  }
}
