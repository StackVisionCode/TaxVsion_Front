import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { SignatureDocumentLibraryComponent } from '../signature-document-library/signature-document-library.component';
import { toApiError } from '@core/models/api-error.model';
import { FileResponse } from '@core/cloud-storage/cloud-storage.model';
import { SignatureStore } from '../../data-access/signature.store';
import { WizardClient } from '../signature-request-panel/signature-wizard.model';
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
}

/** Origen del documento: subir uno nuevo o reusar un PDF de la oficina. */
type DocSource = 'upload' | 'library';

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
  imports: [CommonModule, FormsModule, ModalComponent, SignatureDocumentLibraryComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-template-picker.component.html',
  styleUrl: './signature-template-picker.component.css',
})
export class SignatureTemplatePickerComponent {
  private readonly store = inject(SignatureStore);

  @Input() set isOpen(value: boolean) {
    this.open.set(value);
    if (value) {
      this.reset();
      this.store.loadTemplates();
      this.store.loadCustomers();
    }
  }
  @Output() closed = new EventEmitter<void>();
  /** Solicitud recién creada (queda en Draft, lista para revisar y enviar). */
  @Output() created = new EventEmitter<SignatureRequestDetail>();

  readonly open = signal(false);

  readonly templates = this.store.templates;
  readonly templatesLoading = this.store.templatesLoading;
  readonly templatesError = this.store.templatesError;

  /** null = todavía se está eligiendo el molde. */
  readonly selected = signal<SignatureTemplateDetail | null>(null);
  readonly loadingDetail = signal(false);
  readonly slots = signal<SlotDraft[]>([]);
  readonly description = signal('');
  readonly file = signal<File | null>(null);
  readonly fileError = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  /** Documento: subir uno nuevo o reusar un PDF ya existente en la oficina. */
  readonly docSource = signal<DocSource>('upload');
  readonly libraryFile = signal<FileResponse | null>(null);

  /** Clientes del tenant para el buscador (mapeados a WizardClient por el store). */
  readonly customers = this.store.customers;
  readonly customersLoading = this.store.customersLoading;
  /** Slot cuyo buscador de clientes está abierto (solo uno a la vez). */
  readonly clientPickerSlot = signal<number | null>(null);
  readonly clientQuery = signal('');

  readonly filteredClients = computed<WizardClient[]>(() => {
    const term = this.clientQuery().trim().toLowerCase();
    const list = this.customers();
    if (!term) {
      return list.slice(0, 8);
    }
    return list
      .filter(c => c.displayName.toLowerCase().includes(term) || c.email.toLowerCase().includes(term))
      .slice(0, 8);
  });

  /** true si hay documento válido (subido o de librería). */
  readonly hasDocument = computed(() => (this.docSource() === 'upload' ? !!this.file() : !!this.libraryFile()));

  /** Hace falta el PDF y un firmante completo por cada rol; teléfono si el rol exige SMS/WhatsApp. */
  readonly canCreate = computed(
    () =>
      this.hasDocument() &&
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
    this.file.set(null);
    this.fileError.set('');
    this.error.set('');
    this.docSource.set('upload');
    this.libraryFile.set(null);
    this.clientPickerSlot.set(null);
    this.clientQuery.set('');
  }

  // ---------- Documento: subir vs librería ----------

  setDocSource(source: DocSource): void {
    this.docSource.set(source);
    this.fileError.set('');
    if (source === 'upload') {
      this.libraryFile.set(null);
    } else {
      this.file.set(null);
    }
  }

  onLibraryPicked(file: FileResponse): void {
    this.libraryFile.set(file);
  }

  // ---------- Buscador de cliente por slot ----------

  toggleClientPicker(slotOrder: number): void {
    this.clientQuery.set('');
    this.clientPickerSlot.update(current => (current === slotOrder ? null : slotOrder));
  }

  pickClient(slotOrder: number, client: WizardClient): void {
    // Autollena nombre/email y — clave para SMS/WhatsApp — el teléfono del cliente registrado.
    this.updateSlot(slotOrder, { fullName: client.displayName, email: client.email, phone: client.phone ?? '' });
    this.clientPickerSlot.set(null);
    this.clientQuery.set('');
  }

  /** Al elegir un molde hay que traer su detalle: la lista no incluye los slots. */
  choose(template: TemplateSummary): void {
    this.loadingDetail.set(true);
    this.error.set('');
    this.store.getTemplate(template.id).subscribe({
      next: detail => {
        this.selected.set(detail);
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
            })),
        );
        this.loadingDetail.set(false);
      },
      error: err => {
        this.error.set(toApiError(err).message);
        this.loadingDetail.set(false);
      },
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

  initials(name: string): string {
    return name
      .split(' ')
      .map(part => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  /** Mismo límite que el wizard: PDF y ≤25 MB (el preflight del backend lo repite). */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0] ?? null;
    this.fileError.set('');
    if (!picked) {
      this.file.set(null);
      return;
    }
    if (picked.type !== 'application/pdf') {
      this.fileError.set('Only PDF files can be sent for signature.');
      this.file.set(null);
      return;
    }
    if (picked.size > MAX_PDF_BYTES) {
      this.fileError.set('That PDF is over the 25 MB limit.');
      this.file.set(null);
      return;
    }
    this.file.set(picked);
  }

  create(): void {
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

    // Librería: reusa el fileId existente (sin validar/subir). Upload: valida y sube.
    const library = this.libraryFile();
    const request$ =
      this.docSource() === 'library' && library
        ? this.store.instantiateTemplateWithFileId(template.id, library.id, bindings, note)
        : this.store.instantiateTemplate(template.id, this.file()!, bindings, note);

    request$.subscribe({
      next: detail => {
        this.busy.set(false);
        this.created.emit(detail);
      },
      error: err => {
        this.busy.set(false);
        this.error.set(toApiError(err).message);
      },
    });
  }
}
