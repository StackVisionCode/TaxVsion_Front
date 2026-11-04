import { formatMoney } from '@shared/utils/format.util';
import { StatusTone } from '@shared/ui/status-pill/status-pill.component';

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
 * Ciclo real: Draft → Issued (⇄ Sent) → PartiallyPaid → Paid, con Voided como estado terminal.
 * `Voided` lo produce `/void`; `Sent` lo produce el cambio de estado manual (item 6.2, endpoint
 * `/status`, matriz de transiciones legales del dominio Issued⇄Sent).
 */
export type InvoiceStatus = 'Draft' | 'Issued' | 'Sent' | 'PartiallyPaid' | 'Paid' | 'Voided';

/** Estados que la UI ofrece como filtro: los que el backend puede producir hoy. */
export const FILTERABLE_STATUSES: InvoiceStatus[] = [
  'Draft',
  'Issued',
  'Sent',
  'PartiallyPaid',
  'Paid',
  'Voided',
];

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

/** Espejo de `InvoiceDetailResponse` — lectura RICA (cliente + líneas) para prellenar la edición. */
export interface InvoiceDetailCustomer {
  customerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
}

export interface InvoiceDetailLine {
  description: string;
  quantity: number;
  unitAmountCents: number;
  taxBasisPoints: number;
  catalogItemId: string | null;
}

/** Una fila del rastro de auditoría de estado (item 6.2). Espejo de `InvoiceStatusHistoryEntry`. */
export interface InvoiceStatusHistoryEntry {
  fromStatus: InvoiceStatus | null;
  toStatus: InvoiceStatus;
  /** Created | Issue | Payment | Void | ManualChange. */
  trigger: string;
  reason: string | null;
  changedByUserId: string;
  changedAtUtc: string;
}

export interface InvoiceDetail {
  id: string;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  currency: string;
  notes: string | null;
  customer: InvoiceDetailCustomer;
  lines: InvoiceDetailLine[];
  subtotalCents: number;
  taxTotalCents: number;
  totalCents: number;
  amountPaidCents: number;
  /** Una factura editable: borrador, o emitida/enviada sin pagos. */
  isEditable: boolean;
  /** Anulable: emitida/enviada/parcial/pagada (se repone el stock). */
  isVoidable: boolean;
  /** Borrable (soft): solo borradores. */
  isDeletable: boolean;
  /** Destinos legales de un cambio de estado MANUAL desde el estado actual (matriz del dominio). */
  allowedNextStatuses: InvoiceStatus[];
  /** Historial de transiciones, más reciente primero. */
  statusHistory: InvoiceStatusHistoryEntry[];
  /** Reemisión (item 6.3): se puede anular + reemplazar (emitida/pagada y no reemplazada aún). */
  isReissuable: boolean;
  /** Si es un reemplazo, la original que sustituye. */
  replacesInvoiceId: string | null;
  /** Si fue reemplazada, su reemplazo. */
  replacedByInvoiceId: string | null;
}

/** Cuerpo de `POST /billing/invoices/{id}/status` (item 6.2 — cambio de estado manual). */
export interface ChangeInvoiceStatusRequest {
  toStatus: InvoiceStatus;
  reason: string | null;
}

/** Respuesta de `POST /billing/invoices/{id}/reissue` (item 6.3). El reemplazo nace como borrador. */
export interface ReissueInvoiceResult {
  originalInvoiceId: string;
  replacementInvoiceId: string;
  replacementStatus: InvoiceStatus;
}

/** Cuerpo de `PUT /billing/invoices/{id}` — igual que crear, sin emisor (no se edita). */
export interface UpdateInvoiceRequest {
  customer: InvoiceCustomerInput;
  currency: string;
  lines: InvoiceLineInput[];
  notes: string | null;
}

/** Cuerpo de `POST /billing/invoices/{id}/void`. */
export interface VoidInvoiceRequest {
  reason: string | null;
}

// ---------- Billing: perfil del emisor ----------

/**
 * Espejo de `GET /billing/issuer-profile` (solo lectura): la proyección que Billing arma del perfil de la
 * oficina de Tenant y estampa en cada factura (`name` = nombre legal, o DBA, o nombre de la oficina).
 * Se edita en /company/settings (`/tenants/current/profile`).
 */
export interface IssuerProfile {
  name: string;
  taxId: string;
  line1: string;
  /** Suite / unidad. */
  line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  /** Moneda por defecto del tenant (ISO-4217). Las facturas la usan; el histórico congela la suya. */
  defaultCurrency: string;
}

export const EMPTY_ISSUER_PROFILE: IssuerProfile = {
  name: '',
  taxId: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  zip: '',
  country: 'US',
  phone: '',
  email: '',
  website: '',
  defaultCurrency: 'USD',
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
  /**
   * Cómo quedó el webhook: lo creó el backend (`Automatic`), lo pegó la oficina (`Manual`), se está
   * creando (`Pending`) o no se pudo (`Failed`). Null = nunca se intentó.
   */
  webhookSetup?: 'Automatic' | 'Manual' | 'Pending' | 'Failed' | null;
  statementDescriptor: string;
  isActive: boolean;
  settledAtUtc?: string | null;
  /** URL/endpoint del proveedor, editable. Null = default del adapter (Stripe no la necesita). */
  apiBaseUrl?: string | null;
  /** Ya cobró algo: no se puede borrar (el backend responde 409), solo apagar. Falta = false. */
  hasPayments?: boolean;
}

/**
 * Proveedor de cobro disponible, tal como lo describe su adaptador en PaymentClient (solo vienen los
 * que tienen adaptador registrado). El formulario arma etiquetas y campos con esto.
 */
export interface PaymentProviderDescriptor {
  code: string;
  displayName: string;
  publicKeyLabel: string;
  secretKeyLabel: string;
  /** Si el proveedor avisa por webhook firmado (Stripe: cobros 3DS; PayPal: reembolsos y disputas). */
  usesWebhookSecret: boolean;
  /** Nombre del dato que identifica ese webhook en el proveedor ("Signing secret", "Webhook ID"). */
  webhookSecretLabel?: string | null;
  /** El backend crea el webhook solo al guardar las claves (apagado en local, donde el proveedor no llega). */
  webhookAutoSetup?: boolean;
  /** Si acepta URL de API propia (PayPal: sandbox / live). */
  acceptsApiBaseUrl: boolean;
  apiBaseUrlHelp?: string | null;
  apiBaseUrlPlaceholder?: string | null;
  publicKeyPlaceholder?: string | null;
  secretKeyPlaceholder?: string | null;
  /** Página del proveedor donde están las claves (opcional mientras el backend lo despliega). */
  credentialsHelpUrl?: string | null;
  /** Eventos a marcar al dar de alta el webhook en el proveedor. */
  webhookEvents?: string[] | null;
  /** Ruta relativa del webhook ya resuelta para la oficina (`/payments-client/webhooks/{tenantId}/stripe`). */
  webhookPath?: string | null;
}

/** URL absoluta del webhook: la ruta del catálogo sobre la base pública de la API ('' si falta alguna). */
export function webhookUrl(apiBase: string, path: string | null | undefined): string {
  if (!path) {
    return '';
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (!apiBase) {
    return '';
  }
  return `${apiBase.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

// ---------- Statement descriptor (mismas reglas que el VO de PaymentClient) ----------

export const STATEMENT_DESCRIPTOR_MIN = 5;
export const STATEMENT_DESCRIPTOR_MAX = 22;
const FORBIDDEN_CHARS = /[<>\\'"*]/g;

export type StatementDescriptorError = 'required' | 'length' | 'characters';

/** Valor inicial a partir del nombre de la oficina: sin caracteres prohibidos y recortado a 22; si no llega a 5, vacío. */
export function defaultStatementDescriptor(officeName: string | null | undefined): string {
  const cleaned = (officeName ?? '')
    .replace(FORBIDDEN_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, STATEMENT_DESCRIPTOR_MAX)
    .trim();
  return cleaned.length >= STATEMENT_DESCRIPTOR_MIN ? cleaned : '';
}

/** Error del descriptor (sobre el valor recortado, como el backend) o null si es válido. */
export function statementDescriptorError(value: string): StatementDescriptorError | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'required';
  }
  if (trimmed.length < STATEMENT_DESCRIPTOR_MIN || trimmed.length > STATEMENT_DESCRIPTOR_MAX) {
    return 'length';
  }
  return /[<>\\'"*]/.test(trimmed) ? 'characters' : null;
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

/** Espejo de `PaymentStatus` de PaymentClient. */
export type TenantPaymentStatus =
  | 'Pending'
  | 'Processing'
  | 'RequiresAction'
  | 'Succeeded'
  | 'Failed'
  | 'Cancelled'
  | 'PartiallyRefunded'
  | 'Refunded'
  | 'ChargedBack';

/**
 * Pago de un link (`GET /payments-client/payments/{id}`). Los datos del pagador solo existen en pagos
 * nuevos: `receiptEmail` es lo que escribió el cliente; nombre, email y tarjeta los da el proveedor.
 */
export interface TenantPaymentDetail {
  id: string;
  amountCents: number;
  currency: string;
  taxpayerId: string | null;
  providerCode: string;
  status: TenantPaymentStatus;
  failureReason?: string | null;
  paidAtUtc: string | null;
  receiptEmail?: string | null;
  payerName?: string | null;
  payerEmail?: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
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

// ---------- Catálogo (el cliente usa el DTO compartido @core/customers) ----------

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
  /** Tasa de impuesto por defecto del ítem, en puntos básicos (825 = 8.25%). La línea la toma al agregarlo. */
  taxRateBasisPoints: number;
  isActive: boolean;
}

/** Catalog define su PROPIO paginado (`{items, total, page, pageSize}`), distinto del resto. */
export interface CatalogPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Categoría del catálogo (`/catalog/categories`) — solo lo que necesita el alta rápida. */
export interface BillingCatalogCategory {
  id: string;
  name: string;
}

/**
 * Alta rápida de un producto/servicio desde el picker de la factura (sin salir a Products/Services).
 * Los campos de producto (SKU/costo/unidad/inventario) solo aplican a `kind === 'Product'`; un servicio
 * los deja sin definir.
 */
export interface NewCatalogItemInput {
  name: string;
  kind: 'Product' | 'Service';
  /** Precio en dólares (unidades de UI); se convierte a la moneda del alta. */
  priceAmount: number;
  priceCurrency: string;
  /** Impuesto por defecto en porcentaje (se guarda en puntos básicos). */
  taxPercent: number;
  /** Solo Product: código único por tenant (el backend lo normaliza a mayúsculas). */
  sku?: string | null;
  /** Solo Product: costo en dólares (para margen); usa la misma moneda que el precio. */
  costAmount?: number | null;
  /** Solo Product: unidad de medida (ej. "each", "box", "hour"). */
  unit?: string | null;
  /** Solo Product: si Inventory debe rastrear existencias (default true para productos). */
  trackInventory?: boolean;
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
  /**
   * Tipo del ítem de catálogo del que salió la línea. `Service` es **incontable**: no lleva
   * unidades, su cantidad queda fija en 1 y la UI oculta el campo. `Product` lleva cantidad
   * editable. `null` = línea escrita a mano (se trata como contable, cantidad editable).
   */
  kind: 'Product' | 'Service' | null;
}

export function emptyLine(): InvoiceLineDraft {
  return { description: '', quantity: 1, unitAmount: 0, taxPercent: 0, catalogItemId: null, kind: null };
}

/** Una línea es "vacía" si no se tocó: sin descripción, sin ítem de catálogo y sin precio. */
export function isEmptyLine(line: InvoiceLineDraft): boolean {
  return line.description.trim().length === 0 && !line.catalogItemId && !line.unitAmount;
}

/** Un servicio es incontable: su cantidad siempre es 1 y no se edita. */
export function isCountable(line: InvoiceLineDraft): boolean {
  return line.kind !== 'Service';
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

/** Centavos → texto de moneda (delegado en el `formatMoney` compartido). */
export function formatCents(cents: number, currency: string): string {
  return formatMoney(cents, currency, { fromCents: true });
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

/** Tono de `app-status-pill` (variante `soft`) por estado de factura. */
export function invoiceStatusTone(status: InvoiceStatus): StatusTone {
  switch (status) {
    case 'Paid':
      return 'success';
    case 'PartiallyPaid':
      return 'warning';
    case 'Issued':
    case 'Sent':
      return 'brand';
    case 'Voided':
      return 'muted';
    default:
      return 'neutral';
  }
}

/** Estado del pago en palabras de la oficina (sin jerga del proveedor). */
export function tenantPaymentStatusLabel(status: TenantPaymentStatus): string {
  switch (status) {
    case 'Succeeded':
      return 'Paid';
    case 'PartiallyRefunded':
      return 'Partially refunded';
    case 'Refunded':
      return 'Refunded';
    case 'ChargedBack':
      return 'Disputed';
    case 'Failed':
      return 'Failed';
    case 'Cancelled':
      return 'Cancelled';
    case 'RequiresAction':
      return 'Waiting for the client';
    case 'Pending':
    case 'Processing':
      return 'Processing';
    default:
      return status;
  }
}

export function tenantPaymentStatusTone(status: TenantPaymentStatus): StatusTone {
  switch (status) {
    case 'Succeeded':
      return 'success';
    case 'PartiallyRefunded':
    case 'Refunded':
    case 'Pending':
    case 'Processing':
    case 'RequiresAction':
      return 'warning';
    case 'ChargedBack':
    case 'Failed':
      return 'danger';
    default:
      return 'muted';
  }
}

/** "visa" → "Visa", "amex" → "American Express"; lo desconocido se capitaliza tal cual. */
export function cardBrandLabel(brand: string | null | undefined): string {
  const key = (brand ?? '').trim().toLowerCase();
  const known: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    american_express: 'American Express',
    discover: 'Discover',
    diners: 'Diners Club',
    jcb: 'JCB',
    unionpay: 'UnionPay',
  };
  return known[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ' ') : 'Card');
}

/** Tono de `app-status-pill` (variante `soft`) por estado del link de pago. */
export function paymentLinkStatusTone(status: PaymentLinkStatus): StatusTone {
  switch (status) {
    case 'Active':
      return 'success';
    case 'Used':
      return 'brand';
    case 'Expired':
      return 'warning';
    case 'Revoked':
      return 'muted';
    default:
      return 'neutral';
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
