import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SignatureService } from '../../data-access/signature.service';
import { SignedDocumentDelivery } from '../../data-access/signature.model';
import { SignatureDeliveriesPanelComponent } from './signature-deliveries-panel.component';

const DELIVERY = {
  id: 'd1',
  signerId: 's1',
  recipientEmail: 'ana@example.com',
  purpose: 'Completed',
  status: 'Active',
  createdAtUtc: '2026-11-02T12:00:00',
  lastIssuedAtUtc: '2026-11-02T12:00:00',
  expiresAtUtc: '2026-12-02T12:00:00',
  issueCount: 1,
  accessCount: 0,
  lastAccessedAtUtc: null,
  revokedAtUtc: null,
  items: [{ id: 'i1', title: 'Return.pdf', kind: 'SignedDocument' }],
} as unknown as SignedDocumentDelivery;

function setup(deliveries: SignedDocumentDelivery[], canIssue = false) {
  const service = {
    listDeliveries: vi.fn(() => of(deliveries)),
    revokeDelivery: vi.fn(() => of({ ...DELIVERY, status: 'Revoked' })),
    resendDelivery: vi.fn(),
    issueDeliveries: vi.fn(() => of([DELIVERY])),
  };
  TestBed.configureTestingModule({
    imports: [SignatureDeliveriesPanelComponent],
    providers: [
      { provide: SignatureService, useValue: service },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(SignatureDeliveriesPanelComponent);
  fixture.componentInstance.canIssue = canIssue;
  fixture.componentInstance.request = 'r1';
  return { fixture, component: fixture.componentInstance, service };
}

describe('SignatureDeliveriesPanelComponent', () => {
  it('asks before turning off a link and only then calls the API', async () => {
    const { fixture, component, service } = setup([DELIVERY]);
    await fixture.whenStable();

    component.revoke(DELIVERY);
    expect(component.pendingRevoke()).toBe(DELIVERY);
    expect(service.revokeDelivery).not.toHaveBeenCalled();

    await component.confirmRevoke();
    expect(service.revokeDelivery).toHaveBeenCalledWith('r1', 'd1');
    expect(component.pendingRevoke()).toBeNull();
  });

  it('offers to send the signed documents when a completed request has no deliveries', async () => {
    const { fixture, component, service } = setup([], true);
    await fixture.whenStable();
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('[data-testid="issue-deliveries"]') as HTMLButtonElement;
    expect(button).not.toBeNull();

    await component.issue();
    expect(service.issueDeliveries).toHaveBeenCalledWith('r1');
    expect(component.deliveries()).toEqual([DELIVERY]);
  });

  it('does not offer to send when the request was not set to deliver', async () => {
    const { fixture } = setup([], false);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="issue-deliveries"]')).toBeNull();
  });
});
