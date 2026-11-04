import { vi } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { OfficeCurrencyStore } from '@core/billing/office-currency.store';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { ClipboardService } from '@shared/services/clipboard.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { PaymentLink, PaymentProviderDescriptor, TenantPaymentDetail } from './billing.model';
import { BillingService } from './billing.service';
import { BillingStore } from './billing.store';

const PAYPAL: PaymentProviderDescriptor = {
  code: 'PayPal',
  displayName: 'PayPal',
  publicKeyLabel: 'Client ID',
  secretKeyLabel: 'Client secret',
  usesWebhookSecret: false,
  acceptsApiBaseUrl: true,
};

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
  usedAtUtc: '2026-11-03T01:00:00Z',
  relatedTenantPaymentId: 'p1',
};

const PAYMENT: TenantPaymentDetail = {
  id: 'p1',
  amountCents: 500000,
  currency: 'USD',
  taxpayerId: null,
  providerCode: 'Stripe',
  status: 'Succeeded',
  paidAtUtc: '2026-11-03T01:00:00Z',
  payerName: 'Ana Pérez',
  payerEmail: 'ana@example.com',
  cardBrand: 'visa',
  cardLast4: '4242',
};

/** Proveedores de cobro del store: catálogo del backend y alta sin secreto inventado. */
describe('BillingStore (proveedores de cobro)', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let directory: { byId: ReturnType<typeof vi.fn> };

  function create() {
    service = {
      listPaymentProviders: vi.fn(() => of([PAYPAL])),
      listPaymentConfigs: vi.fn(() => of([])),
      createPaymentConfig: vi.fn(() => of('id')),
      setPaymentSecrets: vi.fn(() => of(null)),
      activateProvider: vi.fn(() => of(null)),
      deactivateProvider: vi.fn(() => of(null)),
      publicApiBase: vi.fn(() => 'https://acme.taxoffix.io'),
      getTenantPayment: vi.fn(() => of(PAYMENT)),
    };
    directory = { byId: vi.fn(() => of(new Map([['c1', { id: 'c1', displayName: 'Ana Pérez' }]]))) };
    toast = { success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        BillingStore,
        { provide: BillingService, useValue: service },
        { provide: ToastService, useValue: toast },
        { provide: ClipboardService, useValue: {} },
        { provide: OfficeCurrencyStore, useValue: {} },
        { provide: CustomerDirectoryStore, useValue: directory },
      ],
    });
    return TestBed.inject(BillingStore);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('carga el catálogo de proveedores', () => {
    const store = create();
    store.loadProviderCatalog();

    expect(service['listPaymentProviders']).toHaveBeenCalledTimes(1);
    expect(store.providerCatalog()).toEqual([PAYPAL]);
    expect(store.providerCatalogFailed()).toBe(false);
  });

  it('si el catálogo falla lo marca para que el formulario avise', () => {
    const store = create();
    service['listPaymentProviders'].mockReturnValue(throwError(() => new Error('boom')));
    store.loadProviderCatalog();

    expect(store.providerCatalog()).toEqual([]);
    expect(store.providerCatalogFailed()).toBe(true);
  });

  it('el alta manda el webhook secret tal cual (vacío si el proveedor no lo usa, sin placeholder) y refresca la lista', () => {
    const store = create();
    store.loadProviderCatalog();
    store.saveProvider(
      {
        providerCode: 'PayPal',
        mode: 'DirectApiKeys',
        publishableKey: 'client-id',
        secretKey: 'client-secret',
        webhookSecret: '',
        statementDescriptor: 'OFFICE',
        apiBaseUrl: 'https://api-m.sandbox.paypal.com',
      },
      () => undefined,
    );

    expect(service['setPaymentSecrets']).toHaveBeenCalledWith('PayPal', { secretKey: 'client-secret', webhookSecret: '' });
    expect(service['activateProvider']).toHaveBeenCalledWith('PayPal');
    expect(toast.success).toHaveBeenCalledWith('PayPal connected and activated.');
    expect(service['listPaymentConfigs']).toHaveBeenCalled();
  });

  it('Update keys: solo reemplaza los secretos (sin crear ni activar aparte) y refresca la lista', () => {
    const store = create();
    store.loadProviderCatalog();
    const done = vi.fn();

    store.updateProviderKeys({ providerCode: 'PayPal', secretKey: ' client-secret ', webhookSecret: ' WH-9 ' }, done);

    expect(service['setPaymentSecrets']).toHaveBeenCalledWith('PayPal', { secretKey: 'client-secret', webhookSecret: 'WH-9' });
    expect(service['createPaymentConfig']).not.toHaveBeenCalled();
    expect(service['activateProvider']).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('PayPal keys updated.');
    expect(done).toHaveBeenCalledTimes(1);
    expect(service['listPaymentConfigs']).toHaveBeenCalled();
    expect(store.savingProvider()).toBe(false);
  });

  it('si Update keys falla avisa y no limpia el formulario', () => {
    const store = create();
    service['setPaymentSecrets'].mockReturnValue(throwError(() => new Error('boom')));
    const done = vi.fn();

    store.updateProviderKeys({ providerCode: 'PayPal', secretKey: 'x', webhookSecret: 'y' }, done);

    expect(toast.error).toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    expect(store.savingProvider()).toBe(false);
  });

  it('el descriptor va recortado y sin respaldo de la marca vieja', () => {
    const store = create();
    const save = (statementDescriptor: string) =>
      store.saveProvider(
        { providerCode: 'PayPal', mode: '', publishableKey: 'id', secretKey: 's', webhookSecret: '', statementDescriptor, apiBaseUrl: '' },
        () => undefined,
      );

    save('  Acme Tax  ');
    expect(service['createPaymentConfig']).toHaveBeenLastCalledWith(
      expect.objectContaining({ statementDescriptor: 'Acme Tax', mode: 'DirectApiKeys', apiBaseUrl: null }),
    );
    save('');
    expect(service['createPaymentConfig']).toHaveBeenLastCalledWith(expect.objectContaining({ statementDescriptor: '' }));
  });

  it('el switch: marca el proveedor en curso, refleja el cambio y lo suelta', () => {
    const store = create();
    const active = new Subject<null>();
    service['deactivateProvider'].mockReturnValue(active);
    const stripe = { id: '1', providerCode: 'Stripe', mode: 'DirectApiKeys', publishableKey: 'pk', hasSecretKey: true, hasWebhookSecret: true, statementDescriptor: 'ACME', isActive: true };
    service['listPaymentConfigs'].mockReturnValue(of([stripe]));
    store.loadPaymentConfigs();
    service['listPaymentConfigs'].mockReturnValue(new Subject());

    store.toggleProvider(stripe);
    expect(store.togglingProvider()).toBe('Stripe');
    // Mientras guarda no acepta otro clic.
    store.toggleProvider(stripe);
    expect(service['deactivateProvider']).toHaveBeenCalledTimes(1);

    active.next(null);
    expect(store.togglingProvider()).toBeNull();
    expect(store.paymentConfigs()[0].isActive).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Provider deactivated.');
  });

  it('si el switch falla suelta el proveedor y avisa', () => {
    const store = create();
    service['activateProvider'].mockReturnValue(throwError(() => new Error('boom')));
    store.toggleProvider({ id: '1', providerCode: 'PayPal', mode: 'DirectApiKeys', publishableKey: 'pk', hasSecretKey: true, hasWebhookSecret: false, statementDescriptor: 'ACME', isActive: false });

    expect(store.togglingProvider()).toBeNull();
    expect(toast.error).toHaveBeenCalled();
  });

  it('borrar un proveedor con pagos (409 HasPayments): lo marca y explica que se apague', () => {
    const store = create();
    const stripe = { id: '1', providerCode: 'Stripe', mode: 'DirectApiKeys', publishableKey: 'pk', hasSecretKey: true, hasWebhookSecret: true, statementDescriptor: 'ACME', isActive: true };
    service['listPaymentConfigs'].mockReturnValue(of([stripe]));
    store.loadPaymentConfigs();
    service['deleteProvider'] = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'TenantPaymentConfig.HasPayments', message: 'x' } })),
    );

    store.deleteProvider(stripe);

    expect(store.paymentConfigs()[0].hasPayments).toBe(true);
    expect(toast.error).toHaveBeenCalledWith("Stripe has payments, so it can't be deleted. Turn it off instead.");
  });

  it('detalle de un link pagado: trae su pago y queda listo', () => {
    const store = create();
    store.openLinkDetail(LINK);

    expect(service['getTenantPayment']).toHaveBeenCalledWith('p1');
    expect(store.linkDetail()).toEqual({
      link: LINK,
      payment: PAYMENT,
      paymentLoading: false,
      paymentFailed: false,
      clientName: null,
    });
    expect(directory.byId).not.toHaveBeenCalled();
  });

  it('detalle de un link para un cliente: resuelve su nombre', () => {
    const store = create();
    store.openLinkDetail({ ...LINK, taxpayerId: 'c1', relatedTenantPaymentId: null });

    expect(service['getTenantPayment']).not.toHaveBeenCalled();
    expect(store.linkDetail()?.clientName).toBe('Ana Pérez');
    expect(store.linkDetail()?.paymentLoading).toBe(false);
  });

  it('si el pago no se puede leer lo marca y deja el resto del detalle', () => {
    const store = create();
    service['getTenantPayment'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    store.openLinkDetail(LINK);

    expect(store.linkDetail()?.paymentFailed).toBe(true);
    expect(store.linkDetail()?.paymentLoading).toBe(false);
    expect(store.linkDetail()?.link).toEqual(LINK);
  });

  it('una respuesta tardía de otro link no pisa el detalle abierto', () => {
    const store = create();
    const late = new Subject<TenantPaymentDetail>();
    service['getTenantPayment'].mockReturnValueOnce(late);
    store.openLinkDetail(LINK);
    service['getTenantPayment'].mockReturnValueOnce(of({ ...PAYMENT, id: 'p2' }));
    store.openLinkDetail({ ...LINK, id: 'l2', relatedTenantPaymentId: 'p2' });

    late.next(PAYMENT);

    expect(store.linkDetail()?.link.id).toBe('l2');
    expect(store.linkDetail()?.payment?.id).toBe('p2');
    store.closeLinkDetail();
    expect(store.linkDetail()).toBeNull();
  });

  it('con un webhook creándose relee los proveedores hasta que deja de estar Pending', () => {
    vi.useFakeTimers();
    try {
      const store = create();
      service['listPaymentConfigs']
        .mockReturnValueOnce(of([{ providerCode: 'Stripe', webhookSetup: 'Pending' }]))
        .mockReturnValueOnce(of([{ providerCode: 'Stripe', webhookSetup: 'Automatic', hasWebhookSecret: true }]));

      store.loadPaymentConfigs();
      expect(store.paymentConfigs()[0].webhookSetup).toBe('Pending');

      vi.advanceTimersByTime(3000);
      expect(service['listPaymentConfigs']).toHaveBeenCalledTimes(2);
      expect(store.paymentConfigs()[0].webhookSetup).toBe('Automatic');

      vi.advanceTimersByTime(30000);
      expect(service['listPaymentConfigs']).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('expone la base pública de la API para el webhook', () => {
    expect(create().publicApiBase()).toBe('https://acme.taxoffix.io');
  });
});
