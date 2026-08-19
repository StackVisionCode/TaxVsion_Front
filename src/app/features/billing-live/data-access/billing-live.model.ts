/** Config de un método de pago del tenant (GET /payments-client/config). */
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

/** Resumen de factura (GET /billing/invoices[/{id}]). */
export interface InvoiceSummary {
  id: string;
  invoiceNumber?: string | null;
  status: string;
  currency: string;
  subtotalCents: number;
  taxTotalCents: number;
  totalCents: number;
  amountDueCents: number;
  amountPaidCents: number;
  pdfFileId?: string | null;
  createdAtUtc: string;
  paidAtUtc?: string | null;
  paymentMethod?: string | null;
  receiptNumber?: string | null;
  receiptHash?: string | null;
  checkoutUrl?: string | null;
}

/** Línea del form de factura (montos en dólares / % para la UI; se convierten a centavos/bps al enviar). */
export interface LineDraft {
  description: string;
  quantity: number;
  unitAmount: number;
  taxPercent: number;
}

/** Branding del template de facturas (Documents): color de marca, logo, nombre y footer. */
export interface Branding {
  displayName?: string | null;
  logoDataUri?: string | null;
  brandColorHex?: string | null;
  footerText?: string | null;
}

/** Datos del emisor (la empresa del tenant) que aparecen en la factura. Se configuran una vez y se
 * recuerdan (localStorage) para reusarlos en cada factura. */
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
}
