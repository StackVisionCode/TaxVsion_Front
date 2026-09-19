import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
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

/** Origen del documento: el documento base de la plantilla (P7), subir uno nuevo, o reusar un PDF de la oficina. */
type DocSource = 'template' | 'upload' | 'library';

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
        return this.docSource() === 'library' ? 'Creating the request…' : 'Uploading and preparing the document…';
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

  // El texto lo resuelve el backend (typeahead server-side, ver constructor): busca sobre
  // TODO el tenant, no sólo el lote precargado. Aquí sólo recortamos a los primeros 8 del
  // dropdown; ya vienen filtrados por el término.
  readonly filteredClients = computed<WizardClient[]>(() => this.customers().slice(0, 8));

  constructor() {
    // Typeahead server-side del buscador de clientes por rol: cada término (debounced)
    // consulta el backend, que busca sobre TODO el tenant — así se encuentran clientes
    // fuera del lote inicial precargado.
    toObservable(this.clientQuery)
      .pipe(
        map(term => term.trim()),
        debounceTime(250),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe(term => this.store.queryCustomers(term));
  }

  /** true si la plantilla elegida trae un documento base (P7). */
  readonly hasTemplateDocument = computed(() => !!this.selected()?.baseDocumentFileId);

  /** true si hay documento válido: el de la plantilla, uno subido, o uno de librería. */
  readonly hasDocument = computed(() => {
    switch (this.docSource()) {
      case 'template':
        return this.hasTemplateDocument();
      case 'upload':
        return !!this.file();
      case 'library':
        return !!this.libraryFile();
    }
  });

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
    if (source !== 'upload') {
      this.file.set(null);
    }
    if (source !== 'library') {
      this.libraryFile.set(null);
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
        // P7: si la plantilla trae documento base, se pre-selecciona; si no, se pide subir/elegir.
        this.docSource.set(detail.baseDocumentFileId ? 'template' : 'upload');
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
    const library = this.libraryFile();
    const source: { file: File } | { fileId: string } | { templateDoc: true } =
      this.docSource() === 'template'
        ? { templateDoc: true }
        : this.docSource() === 'library' && library
          ? { fileId: library.id }
          : { file: this.file()! };

    try {
      const result = await this.store.instantiateTemplateAndSend(template.id, source, bindings, note, p =>
        this.phase.set(p),
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
