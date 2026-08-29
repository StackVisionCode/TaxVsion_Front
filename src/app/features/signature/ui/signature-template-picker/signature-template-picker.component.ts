import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { toApiError } from '@core/models/api-error.model';
import { SignatureStore } from '../../data-access/signature.store';
import {
  SignatureRequestDetail,
  SignatureTemplateDetail,
  SlotBinding,
  TemplateSummary,
} from '../../data-access/signature.model';

/** Lo que el usuario teclea para cada rol del molde. */
interface SlotDraft {
  slotOrder: number;
  role: string;
  email: string;
  fullName: string;
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
  imports: [CommonModule, FormsModule, ModalComponent],
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

  /** Hace falta el PDF y un firmante completo por cada rol del molde. */
  readonly canCreate = computed(
    () =>
      !!this.file() &&
      this.slots().length > 0 &&
      this.slots().every(slot => slot.email.trim().length > 0 && slot.fullName.trim().length > 0),
  );

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
            .map(slot => ({ slotOrder: slot.order, role: slot.role, email: '', fullName: '' })),
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
    const pdf = this.file();
    if (!template || !pdf || !this.canCreate() || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const bindings: SlotBinding[] = this.slots().map(slot => ({
      slotOrder: slot.slotOrder,
      email: slot.email.trim(),
      fullName: slot.fullName.trim(),
    }));
    this.store
      .instantiateTemplate(template.id, pdf, bindings, this.description().trim() || null)
      .subscribe({
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
