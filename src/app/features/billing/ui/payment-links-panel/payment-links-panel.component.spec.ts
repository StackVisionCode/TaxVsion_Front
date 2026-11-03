import { TestBed } from '@angular/core/testing';
import { PaymentLink } from '../../data-access/billing.model';
import { PaymentLinksPanelComponent } from './payment-links-panel.component';

const LINK: PaymentLink = {
  id: 'l1',
  taxpayerId: null,
  amountCents: 500000,
  currency: 'USD',
  purposeKind: 'DepositPayment',
  purposeExternalReferenceId: null,
  token: 'tok',
  status: 'Active',
  expiresAtUtc: '2026-11-10T00:00:00Z',
  createdAtUtc: '2026-11-03T00:00:00Z',
  usedAtUtc: null,
  relatedTenantPaymentId: null,
};

describe('PaymentLinksPanelComponent', () => {
  function render() {
    TestBed.configureTestingModule({ imports: [PaymentLinksPanelComponent] });
    const fixture = TestBed.createComponent(PaymentLinksPanelComponent);
    fixture.componentInstance.links = [LINK];
    fixture.componentInstance.canManage = true;
    fixture.detectChanges();
    const opened: PaymentLink[] = [];
    fixture.componentInstance.detailRequested.subscribe(l => opened.push(l));
    return { host: fixture.nativeElement as HTMLElement, opened, fixture };
  }

  it('clic en la fila o en "Details" abre el detalle de ese link', () => {
    const { host, opened } = render();

    host.querySelector<HTMLElement>('[data-testid="link-row"] td')!.click();
    host.querySelector<HTMLButtonElement>('[data-testid="link-details"]')!.click();

    expect(opened).toEqual([LINK, LINK]);
  });

  it('copiar o revocar no abre el detalle', () => {
    const { host, opened, fixture } = render();
    const copied: string[] = [];
    fixture.componentInstance.copyRequested.subscribe(url => copied.push(url));

    host.querySelector<HTMLButtonElement>('[aria-label="Copy payment link"]')!.click();
    host.querySelector<HTMLButtonElement>('[aria-label="Revoke payment link"]')!.click();

    expect(copied.length).toBe(1);
    expect(opened).toEqual([]);
  });
});
