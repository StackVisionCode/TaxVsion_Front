import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { CatalogItemPickerComponent } from '../catalog-item-picker/catalog-item-picker.component';
import {
  BillingCatalogItem,
  InvoiceDetail,
  InvoiceLineDraft,
  draftTotals,
  emptyLine,
  formatCents,
  isCountable,
  isEmptyLine,
  lineTotals,
} from '../../data-access/billing.model';
import { CustomerSummary } from '@core/customers/customer-summary.model';

/** Lo que el formulario emite al guardar. */
export interface InvoiceFormSubmit {
  customer: CustomerSummary;
  customerTaxId: string;
  currency: string;
  lines: InvoiceLineDraft[];
  notes: string;
  /** "Save and issue" emite `true`: crea el borrador y lo emite en la misma acción. */
  alsoIssue: boolean;
}

/** Monedas ofrecidas. El backend acepta cualquier ISO-4217 de 3 letras, no un enum cerrado. */
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'MXN', 'DOP'];

/**
 * Alta de factura. Es un camino de una sola dirección: Billing **no tiene endpoint de update**, así
 * que una vez creada la factura ya no se puede editar (solo emitirla y cobrarla). Por eso el
 * formulario valida antes de mandar en vez de confiar en poder corregir después.
 *
 * Los totales se calculan acá con la MISMA aritmética que el backend
 * (`unitAmountCents × quantity`, impuesto en puntos básicos redondeado alejándose de cero), para
 * que lo que se ve en pantalla sea exactamente lo que se guarda.
 *
 * No hay campo de descuento a propósito: `CreateInvoiceDraftRequest` no lo tiene y el handler fuerza
 * `DiscountTotal = Money.Zero`, así que un descuento en la UI sería una mentira.
 */
@Component({
  selector: 'app-invoice-form-panel',
  imports: [CommonModule, FormsModule, ModalComponent, CatalogItemPickerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './invoice-form-panel.component.html',
})
export class InvoiceFormPanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() customerResults: CustomerSummary[] = [];
  @Input() customerSearching = false;
  @Input() catalogResults: BillingCatalogItem[] = [];
  @Input() catalogSearching = false;
  @Input() saving = false;
  /** Sin perfil de emisor guardado el PDF sale sin los datos de la firma: se avisa arriba. */
  @Input() hasIssuerProfile = true;
  /** Cuando viene un detalle, el formulario está en modo EDICIÓN (prellena y guarda cambios). */
  @Input() editing: InvoiceDetail | null = null;
  /** Stock disponible por catalogItemId (number = disponible rastreado; null = sin límite). Solo aviso. */
  @Input() stockByItem: Record<string, number | null> = {};

  @Output() closed = new EventEmitter<void>();
  @Output() customerSearchChanged = new EventEmitter<string>();
  @Output() catalogSearchChanged = new EventEmitter<string>();
  @Output() submitted = new EventEmitter<InvoiceFormSubmit>();
  /** Pide al contenedor el stock de un producto del catálogo (para el aviso de cantidad). */
  @Output() stockLookupRequested = new EventEmitter<string>();

  readonly currencies = CURRENCIES;

  /** True cuando el formulario edita una factura existente (cambia título/botones y camino de guardado). */
  get isEditing(): boolean {
    return this.editing !== null;
  }

  readonly customer = signal<CustomerSummary | null>(null);
  readonly customerQuery = signal('');
  readonly customerPickerOpen = signal(false);
  readonly customerTaxId = signal('');
  readonly currency = signal('USD');
  readonly notes = signal('');
  readonly lines = signal<InvoiceLineDraft[]>([emptyLine()]);

  /** Índice de la línea que se está rellenando desde el catálogo (null = picker cerrado). */
  readonly catalogTargetIndex = signal<number | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    // Cada apertura empieza en limpio: no hay edición, así que no hay nada que precargar.
    if (changes['isOpen'] && this.isOpen) {
      this.reset();
    }
  }

  // ---------- Cliente ----------

  onCustomerQuery(value: string): void {
    this.customerQuery.set(value);
    this.customerPickerOpen.set(true);
    this.customerSearchChanged.emit(value);
  }

  onCustomerFocus(): void {
    this.customerPickerOpen.set(true);
    this.customerSearchChanged.emit(this.customerQuery());
  }

  /** Cierra con delay para que el click en un resultado gane al blur. */
  closeCustomerPickerSoon(): void {
    setTimeout(() => this.customerPickerOpen.set(false), 150);
  }

  pickCustomer(customer: CustomerSummary): void {
    this.customer.set(customer);
    this.customerQuery.set('');
    this.customerPickerOpen.set(false);
  }

  clearCustomer(): void {
    this.customer.set(null);
    this.customerQuery.set('');
  }

  // ---------- Líneas ----------

  /**
   * Identidad estable de fila por índice: sin esto, cada tecla en Qty/Price recrea todos los `<tr>`
   * (updateLine reemplaza los objetos de línea) y el input pierde el foco a mitad de escribir.
   */
  trackByIndex(index: number): number {
    return index;
  }

  addLine(): void {
    this.lines.update(lines => [...lines, emptyLine()]);
  }

  removeLine(index: number): void {
    this.lines.update(lines => (lines.length === 1 ? lines : lines.filter((_, i) => i !== index)));
  }

  updateLine(index: number, patch: Partial<InvoiceLineDraft>): void {
    this.lines.update(lines => lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  /** Editar a mano una línea que vino del catálogo la desvincula: ya no es ese ítem (ni su tipo). */
  updateLineText(index: number, description: string): void {
    this.updateLine(index, { description, catalogItemId: null, kind: null });
  }

  /** Solo los productos (y las líneas manuales) editan cantidad; un servicio es incontable. */
  isCountable(line: InvoiceLineDraft): boolean {
    return isCountable(line);
  }

  openCatalog(index: number): void {
    this.catalogTargetIndex.set(index);
    this.catalogSearchChanged.emit('');
  }

  closeCatalog(): void {
    this.catalogTargetIndex.set(null);
  }

  /**
   * Añade el ítem del catálogo a la factura. Si ese MISMO ítem ya está en otra línea, **suma 1 a la
   * cantidad** de la existente en vez de duplicarlo (un servicio, al ser incontable, se queda en 1);
   * si la línea que se estaba rellenando quedó vacía, se descarta. Si el ítem es nuevo, congela
   * nombre y precio en la línea destino y guarda su id (trazabilidad) y su tipo (Product/Service).
   */
  applyCatalogItem(item: BillingCatalogItem): void {
    const index = this.catalogTargetIndex();
    if (index === null) {
      return;
    }

    const lines = this.lines();
    const existingIndex = lines.findIndex((line, i) => i !== index && line.catalogItemId === item.id);

    if (existingIndex !== -1) {
      // Ya existe: incrementar la cantidad de la línea existente (servicio incontable → sigue en 1).
      const existing = lines[existingIndex];
      const nextQuantity = isCountable(existing) ? (existing.quantity || 0) + 1 : 1;
      this.updateLine(existingIndex, { quantity: nextQuantity });
      // Descartar la línea destino solo si estaba vacía (y nunca dejar la factura sin líneas).
      if (isEmptyLine(lines[index]) && this.lines().length > 1) {
        this.removeLine(index);
      }
    } else {
      // Ítem nuevo: rellenar la línea destino. Un servicio entra con cantidad fija 1.
      const kind = item.kind;
      this.updateLine(index, {
        description: item.name,
        unitAmount: item.price?.amount ?? 0,
        // El impuesto por defecto del ítem del catálogo (puntos básicos → %). Editable después.
        taxPercent: (item.taxRateBasisPoints ?? 0) / 100,
        catalogItemId: item.id,
        kind,
        ...(kind === 'Service' ? { quantity: 1 } : {}),
      });
    }

    if (item.price?.currency) {
      this.currency.set(item.price.currency);
    }
    // Pedir su stock para poder avisar si la cantidad se pasa (no bloquea, el bloqueo es al emitir).
    // Se pide para cualquier ítem: un servicio/no-rastreado devuelve "sin límite" y no genera aviso.
    this.stockLookupRequested.emit(item.id);
    this.catalogTargetIndex.set(null);
  }

  /**
   * Aviso de stock de una línea del catálogo: devuelve el disponible cuando la cantidad lo supera, o
   * null si no hay que avisar (línea manual, sin límite conocido, o cantidad dentro del stock). No
   * depende del `kind` (que no llega al editar): se basa en que el ítem tenga stock rastreado numérico.
   */
  stockShortfall(line: InvoiceLineDraft): number | null {
    if (!line.catalogItemId) {
      return null;
    }
    const available = this.stockByItem[line.catalogItemId];
    if (available === undefined || available === null) {
      return null;
    }
    return line.quantity > available ? available : null;
  }

  // ---------- Totales ----------

  readonly totals = computed(() => draftTotals(this.lines()));

  lineTotal(line: InvoiceLineDraft): number {
    return lineTotals(line).totalCents;
  }

  money(cents: number): string {
    return formatCents(cents, this.currency());
  }

  // ---------- Validación y envío ----------

  /** Toda línea necesita descripción, cantidad ≥ 1 e importe > 0 (el backend rechaza lo demás). */
  readonly linesAreValid = computed(() =>
    this.lines().every(
      line => line.description.trim().length > 0 && line.quantity >= 1 && line.unitAmount > 0,
    ),
  );

  readonly canSubmit = computed(() => !this.saving && !!this.customer() && this.linesAreValid());

  submit(alsoIssue: boolean): void {
    const customer = this.customer();
    if (!this.canSubmit() || !customer) {
      return;
    }
    this.submitted.emit({
      customer,
      customerTaxId: this.customerTaxId(),
      currency: this.currency(),
      lines: this.lines(),
      notes: this.notes(),
      alsoIssue,
    });
  }

  close(): void {
    this.closed.emit();
  }

  private reset(): void {
    this.customerQuery.set('');
    this.customerPickerOpen.set(false);
    this.catalogTargetIndex.set(null);

    const editing = this.editing;
    if (editing) {
      // Modo edición: prellenar con el detalle del backend. El detalle de factura solo trae
      // id/nombre/email/teléfono; kind/status/createdAtUtc no los usa el formulario (placeholders).
      this.customer.set({
        id: editing.customer.customerId,
        displayName: editing.customer.name,
        primaryEmail: editing.customer.email ?? '',
        primaryPhone: editing.customer.phone,
        kind: 'Individual',
        status: 'Active',
        createdAtUtc: '',
      });
      this.customerTaxId.set(editing.customer.taxId ?? '');
      this.currency.set(editing.currency);
      this.notes.set(editing.notes ?? '');
      this.lines.set(
        editing.lines.length > 0
          ? editing.lines.map(line => ({
              description: line.description,
              quantity: line.quantity,
              unitAmount: line.unitAmountCents / 100,
              taxPercent: line.taxBasisPoints / 100,
              catalogItemId: line.catalogItemId,
              kind: null,
            }))
          : [emptyLine()],
      );
      // Pedir el stock de las líneas ligadas al catálogo para el aviso de cantidad.
      for (const line of editing.lines) {
        if (line.catalogItemId) {
          this.stockLookupRequested.emit(line.catalogItemId);
        }
      }
      return;
    }

    this.customer.set(null);
    this.customerTaxId.set('');
    this.currency.set('USD');
    this.notes.set('');
    this.lines.set([emptyLine()]);
  }
}
