/** Un método de pago ofrecible en el checkout (GET /payments-client/checkout/{token}). */
export interface InvoiceCheckoutMethod {
  providerCode: string;
  displayName: string;
  statementDescriptor: string;
  publishableKey: string;
  /** URL/endpoint del proveedor (para gateways no-Stripe). Null = default del adapter. */
  apiBaseUrl?: string | null;
}

/** Datos públicos del checkout de una factura (sin login; el token es la prueba de posesión). */
export interface InvoiceCheckout {
  amountCents: number;
  currency: string;
  purposeKind: string;
  purposeExternalReferenceId?: string | null;
  /** Etiqueta legible (número de factura) para mostrar en vez del id crudo. */
  purposeDescription?: string | null;
  tenantName: string;
  methods: InvoiceCheckoutMethod[];
}

/** Resultado del intento de cobro (POST /payments-client/checkout/{token}/pay). */
export interface PayResult {
  tenantPaymentId: string;
  status: 'Succeeded' | 'Processing' | 'RequiresAction' | 'Failed' | string;
  nextActionType?: string | null;
  nextActionUrl?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export type CheckoutPhase = 'loading' | 'ready' | 'paying' | 'paid' | 'processing' | 'error' | 'invalid';
