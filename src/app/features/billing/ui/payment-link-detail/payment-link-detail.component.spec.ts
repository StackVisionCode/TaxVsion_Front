import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PaymentLink, TenantPaymentDetail } from '../../data-access/billing.model';
import { PaymentLinkDetailState } from '../../data-access/billing.store';
import { PaymentLinkDetailComponent } from './payment-link-detail.component';

const LINK: PaymentLink = {
  id: 'l1',
  taxpayerId: null,
  amountCents: 500000,
  currency: 'USD',
  purposeKind: 'DepositPayment',
  purposeExternalReferenceId: 'Retainer',
  token: 'tok',
  status: 'Used',
  expiresAtUtc: '2026-11-10T00:00:00Z',
  createdAtUtc: '2026-11-03T00:00:00Z',
  usedAtUtc: '2026-11-03T15:00:00Z',
  relatedTenantPaymentId: 'p1',
};

const PAYMENT: TenantPaymentDetail = {
  id: 'p1',
  amountCents: 500000,
  currency: 'USD',
  taxpayerId: null,
  providerCode: 'Stripe',
  status: 'Succeeded',
  paidAtUtc: '2026-11-03T15:00:00Z',
  receiptEmail: 'ana@example.com',
  payerName: 'Ana Pérez',
  payerEmail: 'ANA@example.com',
  cardBrand: 'visa',
  cardLast4: '4242',
};

const state = (overrides: Partial<PaymentLinkDetailState> = {}): PaymentLinkDetailState => ({
  link: LINK,
  payment: PAYMENT,
  paymentLoading: false,
  paymentFailed: false,
  clientName: null,
  ...overrides,
});

describe('PaymentLinkDetailComponent', () => {
  let fixture: ComponentFixture<PaymentLinkDetailComponent>;

  // app-modal porta su contenido a <body>: se busca en document.body.
  const q = (selector: string) => document.body.querySelector(selector);

  function render(value: PaymentLinkDetailState | null) {
    TestBed.configureTestingModule({ imports: [PaymentLinkDetailComponent] });
    fixture = TestBed.createComponent(PaymentLinkDetailComponent);
    fixture.componentRef.setInput('state', value);
    fixture.detectChanges();
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  it('pagado: monto, estado, cuándo, con qué tarjeta y quién pagó', () => {
    render(state());

    expect(q('[data-testid="detail-amount"]')?.textContent?.trim()).toBe('$5,000.00');
    expect(q('[data-testid="detail-status"]')?.textContent?.trim()).toBe('Paid');
    expect(q('[data-testid="detail-paid-at"]')?.textContent).toContain('Nov 3, 2026');
    expect(q('[data-testid="detail-method"]')?.textContent?.trim()).toBe('Visa •••• 4242');
    const payer = q('[data-testid="detail-payer"]')!.textContent!;
    expect(payer).toContain('Ana Pérez');
    expect(payer).toContain('ANA@example.com');
    // El email del recibo es el mismo (sin distinguir mayúsculas): no se repite.
    expect(payer).not.toContain('Receipt sent to');
  });

  it('PayPal sin tarjeta muestra el proveedor y el email del recibo si es otro', () => {
    render(
      state({
        payment: { ...PAYMENT, providerCode: 'PayPal', cardBrand: null, cardLast4: null, payerName: null, payerEmail: 'buyer@paypal.com' },
      }),
    );

    expect(q('[data-testid="detail-method"]')?.textContent?.trim()).toBe('PayPal');
    const payer = q('[data-testid="detail-payer"]')!.textContent!;
    expect(payer).toContain('buyer@paypal.com');
    expect(payer).toContain('Receipt sent to');
    expect(payer).toContain('ana@example.com');
  });

  it('pago viejo sin datos del pagador lo dice en vez de dejar huecos', () => {
    render(state({ payment: { ...PAYMENT, receiptEmail: null, payerName: null, payerEmail: null } }));

    expect(q('[data-testid="detail-payer"]')).toBeNull();
    expect(q('[data-testid="detail-no-payer"]')?.textContent).toContain('No payer details were saved');
  });

  it('si el pago no se pudo leer avisa y muestra los datos del link y el cliente', () => {
    render(state({ payment: null, paymentFailed: true, clientName: 'Ana Pérez' }));

    expect(q('[data-testid="detail-payment-unavailable"]')).not.toBeNull();
    expect(q('[data-testid="detail-status"]')?.textContent?.trim()).toBe('Paid');
    expect(q('[data-testid="detail-client"]')?.textContent?.trim()).toBe('Ana Pérez');
  });

  it('link sin pagar: sin sección de pago y con vencimiento', () => {
    render(state({ link: { ...LINK, status: 'Active', relatedTenantPaymentId: null, usedAtUtc: null }, payment: null }));

    expect(q('#detail-payment-title')).toBeNull();
    expect(q('[data-testid="detail-status"]')?.textContent?.trim()).toBe('Active');
    expect(q('[data-testid="link-detail"]')?.textContent).toContain('Expires');
  });

  it('cerrado (sin estado) no pinta nada', () => {
    render(null);
    expect(q('[data-testid="link-detail"]')).toBeNull();
  });
});
