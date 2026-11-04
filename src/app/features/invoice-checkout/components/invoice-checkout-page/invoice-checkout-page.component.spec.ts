import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { InvoiceCheckoutService } from '../../data-access/invoice-checkout.service';
import { InvoiceCheckout } from '../../data-access/invoice-checkout.model';
import { InvoiceCheckoutPageComponent } from './invoice-checkout-page.component';

// Proveedor sin widget en el front: la página queda lista sin cargar Stripe ni PayPal.
const checkout = (overrides: Partial<InvoiceCheckout> = {}): InvoiceCheckout => ({
  amountCents: 12500,
  currency: 'USD',
  purposeKind: 'Invoice',
  tenantName: 'Manfer Tax Services',
  tenantBrandingKey: 'manfer',
  methods: [{ providerCode: 'Square', displayName: 'Square', statementDescriptor: '', publishableKey: '' }],
  ...overrides,
});

describe('InvoiceCheckoutPageComponent', () => {
  const logoUrl = signal<string | null>(null);
  const branding = { logoUrl, applyForPublicBrandingKey: vi.fn() };

  function render(data: InvoiceCheckout) {
    TestBed.configureTestingModule({
      imports: [InvoiceCheckoutPageComponent],
      providers: [
        { provide: InvoiceCheckoutService, useValue: { getCheckout: () => of(data) } },
        { provide: TenantBrandingService, useValue: branding },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ token: 't' }), queryParamMap: convertToParamMap({}) } },
        },
      ],
    });
    const fixture = TestBed.createComponent(InvoiceCheckoutPageComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    logoUrl.set(null);
    branding.applyForPublicBrandingKey.mockClear();
  });

  it('pide la marca de la oficina y muestra su logo', () => {
    logoUrl.set('https://manfer.taxoffix.io/tenants/branding/assets/logo?v=1');
    const fixture = render(checkout());

    expect(branding.applyForPublicBrandingKey).toHaveBeenCalledWith('manfer', 'Portal');
    const img = fixture.nativeElement.querySelector('img.office-logo') as HTMLImageElement;
    expect(img.src).toContain('/tenants/branding/assets/logo');
    expect(fixture.nativeElement.querySelector('.office-tile')).toBeNull();
  });

  it('sin clave de marca no pide nada y muestra las iniciales', () => {
    logoUrl.set('https://otra.taxoffix.io/logo');
    const fixture = render(checkout({ tenantBrandingKey: null }));

    expect(branding.applyForPublicBrandingKey).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('img.office-logo')).toBeNull();
    expect(fixture.nativeElement.querySelector('.office-tile').textContent.trim()).toBe('MT');
  });

  it('la referencia dice "Invoice" solo en pagos de factura', () => {
    const deposit = render(checkout({ purposeKind: 'DepositPayment', purposeExternalReferenceId: 'Retainer' }));
    expect(deposit.nativeElement.querySelector('.ref').textContent.trim()).toBe('Retainer');
    TestBed.resetTestingModule();

    const invoice = render(checkout({ purposeKind: 'InvoicePayment', purposeDescription: 'INV-0001' }));
    expect(invoice.nativeElement.querySelector('.ref').textContent.trim()).toBe('Invoice INV-0001');
  });

  it('si la imagen falla vuelve a las iniciales', () => {
    logoUrl.set('https://manfer.taxoffix.io/roto');
    const fixture = render(checkout());

    fixture.nativeElement.querySelector('img.office-logo').dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img.office-logo')).toBeNull();
    expect(fixture.nativeElement.querySelector('.office-tile')).not.toBeNull();
  });
});
