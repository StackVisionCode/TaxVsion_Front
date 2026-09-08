/**
 * Espejos del contrato HTTP de la sección de facturación. Tres servicios distintos, todos reales:
 *
 * - **Billing** (`/billing`): facturas y perfil del emisor. Solo 7 endpoints — crear borrador,
 *   emitir, listar, leer, registrar pago manual y leer/guardar el emisor. NO hay update, delete,
 *   void ni envío por email, y el listado solo acepta `take`.
 * - **PaymentClient** (`/payments-client`): configuración del proveedor de cobro (Stripe) y links
 *   de pago sueltos.
 * - **Documents** (`/documents/branding`): marca que se estampa en el PDF de la factura.
 *
 * Los enums viajan como STRING en los tres (JsonStringEnumConverter).
 */

// ---------- Billing: facturas ----------

/**
 * Espejo de `TaxVision.Billing.Domain.ValueObjects.InvoiceStatus`.
 *
 * OJO: `Sent` y `Voided` están declarados en el enum pero **ningún camino de código los asigna**
 * (el agregado no tiene `MarkSent` ni `Void`), así que el ciclo real es
 * Draft → Issued → PartiallyPaid → Paid. Se mantienen en el tipo para no romper si el backend
 * los habilita, pero la UI no ofrece acciones que los produzcan.
 */
export type InvoiceStatus = 'Draft' | 'Issued' | 'Sent' | 'PartiallyPaid' | 'Paid' | 'Voided';

/** Estados que la UI ofrece como filtro: los que el backend puede producir hoy. */
export const FILTERABLE_STATUSES: InvoiceStatus[] = ['Draft', 'Issued', 'PartiallyPaid', 'Paid'];

/** Espejo de `PaymentMethod`. `Online`/`Card` los pone el webhook de Stripe, no la UI. */
export type InvoicePaymentMethod = 'Online' | 'Card' | 'Cash' | 'Check' | 'BankTransfer' | 'Other';

/** Métodos que un empleado puede registrar a mano (cobro offline). */
export const MANUAL_PAYMENT_METHODS: InvoicePaymentMethod[] = ['Cash', 'Check', 'BankTransfer', 'Other'];

/**
 * Espejo de `InvoiceSummaryResponse` — el ÚNICO DTO de lectura de Billing, usado tanto por
 * `GET /billing/invoices` como por `GET /billing/invoices/{id}`.
 *
 * Lo que NO trae, aunque el agregado sí lo guarde: `customerId`/nombre del cliente, `dueDateUtc`,
 * `notes` y `lines`. Por eso la tabla no tiene columna de cliente, no existe "Overdue" (solo
 * "Outstanding") y el detalle no puede mostrar el desglose — todo eso sí está en el PDF.
 */
export interface InvoiceSummary {
  id: string;
  invoiceNumber?: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotalCents: number;
  taxTotalCents: number;
  totalCents: number;
  amountDueCents: number;
  amountPaidCents: number;
  /** Id en CloudStorage. Llega ASÍNCRONO tras emitir (Documents responde 202). */
  pdfFileId?: string | null;
  createdAtUtc: string;
  paidAtUtc?: string | null;
  paymentMethod?: InvoicePaymentMethod | null;
  receiptNumber?: string | null;
  /** SHA-256 del comprobante; el cliente puede verificarlo. Solo cuando está pagada. */
  receiptHash?: string | null;
  /** URL estable de cobro que compone PaymentClient. También llega asíncrona tras emitir. */
  checkoutUrl?: string | null;
}

/** Respuesta de `POST /billing/invoices`. */
export interface CreateInvoiceResult {
  invoiceId: string;
  status: InvoiceStatus;
}

/** Respuesta de `POST /billing/invoices/{id}/issue` — acá nace el número definitivo. */
export interface IssueInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
}

/** Espejo de `InvoiceLineInput`. Montos en centavos e impuesto en puntos básicos. */
export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitAmountCents: number;
  taxBasisPoints: number;
  /** Referencia débil al ítem de Catalog del que se copió la línea (solo trazabilidad). */
  catalogItemId?: string | null;
}

/** Espejo de `InvoiceCustomerInput`. `customerId` DEBE ser el GUID real del maestro Customer. */
export interface InvoiceCustomerInput {
  customerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  billing: null;
}

/** Cuerpo de `POST /billing/invoices`. `issuer: null` → Billing estampa el perfil guardado. */
export interface CreateInvoiceRequest {
  customer: InvoiceCustomerInput;
  currency: string;
  lines: InvoiceLineInput[];
  notes: string | null;
  issuer: null;
}

// ---------- Billing: perfil del emisor ----------

/** Espejo de `IssuerProfileResponse` / `UpsertIssuerProfileRequest`. Solo `name` es obligatorio. */
export interface IssuerProfile {
  name: string;
  taxId: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  email: string;
  website: string;
}

export const EMPTY_ISSUER_PROFILE: IssuerProfile = {
  name: '',
  taxId: '',
  line1: '',
  city: '',
  state: '',
  zip: '',
  country: 'US',
  phone: '',
  email: '',
  website: '',
};

// ---------- Documents: marca del PDF ----------

/** Espejo de `GET|PUT /documents/branding`. No hay selector de plantilla: solo estos 4 campos. */
export interface InvoiceBranding {
  displayName: string | null;
  logoDataUri: string | null;
  brandColorHex: string | null;
  footerText: string | null;
}

// ---------- PaymentClient: proveedor de cobro ----------

/** Espejo de la config de un proveedor (`GET /payments-client/config`). */
export interface PaymentConfig {
  id: string;
  providerCode: string;
  mode: string;
  publishableKey: string;
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  statementDescriptor: string;
  isActive: boolean;
  settledAtUtc?: string | null;
}

// ---------- PaymentClient: links de pago ----------

/** Espejo de `PaymentLinkStatus`. */
export type PaymentLinkStatus = 'Active' | 'Used' | 'Expired' | 'Revoked';

/** Espejo de `PaymentPurposeKind`. */
export type PaymentPurposeKind =
  | 'InvoicePayment'
  | 'DepositPayment'
  | 'RetainerPayment'
  | 'RefundIssuance'
  | 'Other';

/** Propósitos que tiene sentido elegir a mano (`RefundIssuance` no es un cobro). */
export const SELECTABLE_PURPOSES: PaymentPurposeKind[] = [
  'DepositPayment',
  'RetainerPayment',
  'InvoicePayment',
  'Other',
];

/** Espejo de `PaymentLinkResponse`. */
export interface PaymentLink {
  id: string;
  taxpayerId: string | null;
  amountCents: number;
  currency: string;
  purposeKind: PaymentPurposeKind;
  purposeExternalReferenceId: string | null;
  /** Lo que va en la URL pública `/pay/{token}` que sirve esta misma app. */
  token: string;
  status: PaymentLinkStatus;
  expiresAtUtc: string;
  createdAtUtc: string;
  usedAtUtc: string | null;
  relatedTenantPaymentId: string | null;
}

/** Respuesta de `POST /payments-client/payment-links`. */
export interface CreatePaymentLinkResult {
  id: string;
  token: string;
  expiresAtUtc: string;
}

/**
 * Opciones de caducidad. El valor es el formato `TimeSpan` de .NET (`[d.]hh:mm:ss`), que es como
 * System.Text.Json lo deserializa; el dominio rechaza ≤ 0 y > 30 días, así que estas son las
 * mismas cinco del CRM legado y todas caben dentro del límite.
 */
export const EXPIRATION_OPTIONS: { label: string; value: string }[] = [
  { label: '1 hour', value: '01:00:00' },
  { label: '24 hours', value: '1.00:00:00' },
  { label: '48 hours', value: '2.00:00:00' },
  { label: '7 days', value: '7.00:00:00' },
  { label: '30 days', value: '30.00:00:00' },
];

// ---------- Clientes y catálogo (réplicas, sin imports cross-feature) ----------

/**
 * Subset de `GET /customers` para el picker de la factura. Réplica del shape (patrón mail/task):
 * las features no se importan entre sí.
 */
export interface BillingCustomerSummary {
  id: string;
  displayName: string;
  primaryEmail: string;
  primaryPhone: string | null;
}

/**
 * Subset de `CatalogItemDto` (`GET /catalog/items`) para rellenar una línea. El precio viene como
 * Money (`{amount, currency}`) y `id` es lo que viaja como `catalogItemId` en la línea.
 */
export interface BillingCatalogItem {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  kind: 'Product' | 'Service';
  price: { amount: number; currency: string };
  isActive: boolean;
}

/** Catalog define su PROPIO paginado (`{items, total, page, pageSize}`), distinto del resto. */
export interface CatalogPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------- Borrador del formulario (unidades de UI) ----------

/**
 * Línea tal como se edita: dólares y porcentaje. Se convierte a centavos y puntos básicos al
 * enviar, con la MISMA aritmética que aplica el backend (ver {@link lineTotals}).
 */
export interface InvoiceLineDraft {
  description: string;
  quantity: number;
  unitAmount: number;
  taxPercent: number;
  /** Se fija cuando la línea se rellenó desde el catálogo; null si se escribió a mano. */
  catalogItemId: string | null;
}

export function emptyLine(): InvoiceLineDraft {
  return { description: '', quantity: 1, unitAmount: 0, taxPercent: 0, catalogItemId: null };
}

// ---------- Helpers de dinero ----------

/** Dólares → centavos. Billing trabaja SIEMPRE en centavos enteros. */
export function toCents(amount: number): number {
  return Math.round((Number.isFinite(amount) ? amount : 0) * 100);
}

/** Porcentaje → puntos básicos (8.25% → 825). El backend rechaza fuera de [0, 100000]. */
export function toBasisPoints(percent: number): number {
  return Math.round((Number.isFinite(percent) ? percent : 0) * 100);
}

export interface LineTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * Totales de una línea replicando EXACTAMENTE `CreateInvoiceDraftHandler`:
 * `subtotal = unitAmountCents × quantity` y `tax = round(subtotal × bps / 10000)` alejándose de
 * cero. Como los montos nunca son negativos (el VO `Money` los rechaza), `Math.round` de JS
 * coincide con el `MidpointRounding.AwayFromZero` de .NET. Sin esto, lo que muestra el formulario
 * y lo que guarda el backend podrían diferir por céntimos.
 */
export function lineTotals(line: InvoiceLineDraft): LineTotals {
  const quantity = Math.max(0, Math.trunc(line.quantity || 0));
  const subtotalCents = toCents(line.unitAmount) * quantity;
  const taxCents = Math.round((subtotalCents * toBasisPoints(line.taxPercent)) / 10_000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

/** Totales de la factura entera, sumando línea por línea (igual que el handler). */
export function draftTotals(lines: InvoiceLineDraft[]): LineTotals {
  return lines.reduce<LineTotals>(
    (acc, line) => {
      const totals = lineTotals(line);
      return {
        subtotalCents: acc.subtotalCents + totals.subtotalCents,
        taxCents: acc.taxCents + totals.taxCents,
        totalCents: acc.totalCents + totals.totalCents,
      };
    },
    { subtotalCents: 0, taxCents: 0, totalCents: 0 },
  );
}

/** Centavos → texto de moneda. Con decimales, a diferencia del widget del dashboard. */
export function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

// ---------- Helpers de presentación ----------

export function invoiceStatusLabel(status: InvoiceStatus): string {
  switch (status) {
    case 'Draft':
      return 'Draft';
    case 'Issued':
      return 'Awaiting payment';
    case 'Sent':
      return 'Sent';
    case 'PartiallyPaid':
      return 'Partially paid';
    case 'Paid':
      return 'Paid';
    case 'Voided':
      return 'Voided';
    default:
      return status;
  }
}

/** Clases del chip de estado (borde + fondo + texto) y del punto, en el estilo de las otras tablas. */
export function invoiceStatusChip(status: InvoiceStatus): string {
  switch (status) {
    case 'Paid':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'PartiallyPaid':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'Issued':
    case 'Sent':
      return 'border-indigo-200 bg-indigo-50 text-brand-bold';
    case 'Voided':
      return 'border-gray-200 bg-gray-50 text-gray-500';
    default:
      return 'border-gray-200 bg-white text-gray-600';
  }
}

export function invoiceStatusDot(status: InvoiceStatus): string {
  switch (status) {
    case 'Paid':
      return 'bg-emerald-500';
    case 'PartiallyPaid':
      return 'bg-amber-500';
    case 'Issued':
    case 'Sent':
      return 'bg-brand-bold';
    default:
      return 'bg-gray-300';
  }
}

export function paymentLinkStatusChip(status: PaymentLinkStatus): string {
  switch (status) {
    case 'Active':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'Used':
      return 'border-indigo-200 bg-indigo-50 text-brand-bold';
    case 'Expired':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'Revoked':
      return 'border-gray-200 bg-gray-50 text-gray-500';
    default:
      return 'border-gray-200 bg-white text-gray-600';
  }
}

/** Etiqueta legible del propósito del link (`DepositPayment` → "Deposit"). */
export function purposeLabel(kind: PaymentPurposeKind): string {
  switch (kind) {
    case 'InvoicePayment':
      return 'Invoice';
    case 'DepositPayment':
      return 'Deposit';
    case 'RetainerPayment':
      return 'Retainer';
    case 'RefundIssuance':
      return 'Refund';
    default:
      return 'Other';
  }
}

/** URL pública del link: la sirve esta misma app en `/pay/:token` (features/invoice-checkout). */
export function paymentLinkUrl(token: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/pay/${token}`;
}

// ---------- Exportación ----------

/** Columnas del CSV. Solo lo que el contrato devuelve: no hay cliente ni vencimiento que exportar. */
const CSV_HEADERS = [
  'Number',
  'Status',
  'Currency',
  'Subtotal',
  'Tax',
  'Total',
  'Paid',
  'Amount due',
  'Created',
  'Paid on',
  'Payment method',
  'Receipt number',
];

/** Escapa un valor para CSV (comillas dobladas y campo entrecomillado si hace falta). */
function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Serializa a CSV las facturas ya cargadas y filtradas. Los importes van en unidades (no centavos)
 * para que una hoja de cálculo los sume tal cual.
 */
export function invoicesToCsv(invoices: InvoiceSummary[]): string {
  const rows = invoices.map(invoice =>
    [
      invoice.invoiceNumber ?? '',
      invoice.status,
      invoice.currency,
      (invoice.subtotalCents / 100).toFixed(2),
      (invoice.taxTotalCents / 100).toFixed(2),
      (invoice.totalCents / 100).toFixed(2),
      (invoice.amountPaidCents / 100).toFixed(2),
      (invoice.amountDueCents / 100).toFixed(2),
      invoice.createdAtUtc ?? '',
      invoice.paidAtUtc ?? '',
      invoice.paymentMethod ?? '',
      invoice.receiptNumber ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [CSV_HEADERS.join(','), ...rows].join('\n');
}
