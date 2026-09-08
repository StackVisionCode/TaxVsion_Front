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
  BillingCustomerSummary,
  InvoiceLineDraft,
  draftTotals,
  emptyLine,
  formatCents,
  lineTotals,
} from '../../data-access/billing.model';

/** Lo que el formulario emite al guardar. */
export interface InvoiceFormSubmit {
  customer: BillingCustomerSummary;
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
  @Input() customerResults: BillingCustomerSummary[] = [];
  @Input() customerSearching = false;
  @Input() catalogResults: BillingCatalogItem[] = [];
  @Input() catalogSearching = false;
  @Input() saving = false;
  /** Sin perfil de emisor guardado el PDF sale sin los datos de la firma: se avisa arriba. */
  @Input() hasIssuerProfile = true;

  @Output() closed = new EventEmitter<void>();
  @Output() customerSearchChanged = new EventEmitter<string>();
  @Output() catalogSearchChanged = new EventEmitter<string>();
  @Output() submitted = new EventEmitter<InvoiceFormSubmit>();

  readonly currencies = CURRENCIES;

  readonly customer = signal<BillingCustomerSummary | null>(null);
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

  pickCustomer(customer: BillingCustomerSummary): void {
    this.customer.set(customer);
    this.customerQuery.set('');
    this.customerPickerOpen.set(false);
  }

  clearCustomer(): void {
    this.customer.set(null);
    this.customerQuery.set('');
  }

  // ---------- Líneas ----------

  addLine(): void {
    this.lines.update(lines => [...lines, emptyLine()]);
  }

  removeLine(index: number): void {
    this.lines.update(lines => (lines.length === 1 ? lines : lines.filter((_, i) => i !== index)));
  }

  updateLine(index: number, patch: Partial<InvoiceLineDraft>): void {
    this.lines.update(lines => lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  /** Editar a mano una línea que vino del catálogo la desvincula: ya no es ese ítem. */
  updateLineText(index: number, description: string): void {
    this.updateLine(index, { description, catalogItemId: null });
  }

  openCatalog(index: number): void {
    this.catalogTargetIndex.set(index);
    this.catalogSearchChanged.emit('');
  }

  closeCatalog(): void {
    this.catalogTargetIndex.set(null);
  }

  /** Copia (congela) nombre y precio del ítem en la línea y guarda su id para trazabilidad. */
  applyCatalogItem(item: BillingCatalogItem): void {
    const index = this.catalogTargetIndex();
    if (index === null) {
      return;
    }
    this.updateLine(index, {
      description: item.name,
      unitAmount: item.price?.amount ?? 0,
      catalogItemId: item.id,
    });
    if (item.price?.currency) {
      this.currency.set(item.price.currency);
    }
    this.catalogTargetIndex.set(null);
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
    this.customer.set(null);
    this.customerQuery.set('');
    this.customerPickerOpen.set(false);
    this.customerTaxId.set('');
    this.currency.set('USD');
    this.notes.set('');
    this.lines.set([emptyLine()]);
    this.catalogTargetIndex.set(null);
  }
}
