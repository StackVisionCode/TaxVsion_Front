import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { PublicSignerView } from '../../data-access/public-signature.model';
import { PublicSignatureService } from '../../data-access/public-signature.service';
import { SignPageComponent } from './sign-page.component';

function signerView(): PublicSignerView {
  return {
    signatureRequestId: 'request-1',
    signerId: 'signer-1',
    title: 'Tax package',
    description: null,
    category: 'Fiscal',
    requestStatus: 'InProgress',
    signerStatus: 'Pending',
    requiresConsent: false,
    hasAcceptedConsent: true,
    requiresSequentialSigning: false,
    isSignerNextInSequence: true,
    order: 1,
    expiresAtUtc: null,
    signerFullName: 'Ana Client',
    signerEmail: 'ana@example.com',
    requiresPractitionerPin: false,
    isPinVerified: false,
    pinLockedUntilUtc: null,
    requiredVerificationMethod: null,
    isVerificationCompleted: false,
    documents: [
      {
        documentId: 'doc-2',
        title: 'W-2 2025',
        order: 2,
        hasFieldsToSign: true,
        firstViewedAtUtc: null,
        signedAtUtc: null,
      },
      {
        documentId: 'doc-1',
        title: 'Form 1040',
        order: 1,
        hasFieldsToSign: true,
        firstViewedAtUtc: null,
        signedAtUtc: null,
      },
      {
        documentId: 'doc-3',
        title: 'Office copy',
        order: 3,
        hasFieldsToSign: false,
        firstViewedAtUtc: null,
        signedAtUtc: null,
      },
    ],
    fields: [
      {
        id: 'field-2',
        documentId: 'doc-2',
        kind: 'Text',
        page: 1,
        x: 0.1,
        y: 0.3,
        width: 0.3,
        height: 0.05,
        label: 'Employer',
        isRequired: true,
      },
      {
        id: 'field-1',
        documentId: 'doc-1',
        kind: 'Text',
        page: 1,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.05,
        label: 'SSN',
        isRequired: true,
      },
    ],
    tenantSubDomain: 'office',
    partialCopyWillBeSent: false,
  };
}

describe('SignPageComponent multi-document navigation', () => {
  it('keeps the help dialog inside the styled signing surface', async () => {
    const api = {
      getContext: vi.fn(() => of(signerView())),
      getDocumentBytes: vi.fn(() => of(new Uint8Array())),
    };
    const branding = {
      logoUrl: signal<string | null>(null),
      systemLogoUrl: signal<string | null>(null),
      applyForSurface: vi.fn(),
      loadSystemBrandLogo: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [SignPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'token' } } } },
        { provide: PublicSignatureService, useValue: api },
        { provide: TenantBrandingService, useValue: branding },
      ],
    });
    const fixture = TestBed.createComponent(SignPageComponent);
    fixture.componentInstance.helpOpen.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('.signing-page') as HTMLElement | null;
    const overlay = root?.querySelector(':scope > .help-overlay');
    expect(root).not.toBeNull();
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('avanza localmente entre documentos y reserva el submit para el último', () => {
    const api = {
      getDocumentBytes: vi.fn(() => of(new Uint8Array())),
      sign: vi.fn(() => of(undefined)),
    };
    TestBed.configureTestingModule({
      imports: [SignPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'token' } } } },
        { provide: PublicSignatureService, useValue: api },
      ],
    });
    TestBed.overrideComponent(SignPageComponent, { set: { template: '', imports: [] } });
    const component = TestBed.createComponent(SignPageComponent).componentInstance;
    const submit = vi.fn(async () => undefined);
    (component as unknown as { submitSignature: () => Promise<void> }).submitSignature = submit;
    component.context.set(signerView());
    component.stepId.set('sign');

    expect(component.documentProgress()).toBe('Document 1 of 2 — Form 1040');
    expect(component.fields().map((field) => field.id)).toEqual(['field-1']);
    expect(component.nextLabel()).toBe('Next document');

    component.fieldValues.set({ 'field-1': '123-45-6789' });
    component.next();

    expect(component.activeDocument()?.documentId).toBe('doc-2');
    expect(component.fields().map((field) => field.id)).toEqual(['field-2']);
    expect(component.nextLabel()).toBe('Finish & submit');
    expect(api.sign).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();

    component.fieldValues.update((values) => ({ ...values, 'field-2': 'ACME' }));
    (component as unknown as { signReady: () => boolean }).signReady = () => true;
    component.next();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('requires every document to be reviewed before opening the signing step', () => {
    const api = {
      getDocumentBytes: vi.fn(() => of(new Uint8Array())),
      sign: vi.fn(() => of(undefined)),
    };
    TestBed.configureTestingModule({
      imports: [SignPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'token' } } } },
        { provide: PublicSignatureService, useValue: api },
      ],
    });
    TestBed.overrideComponent(SignPageComponent, { set: { template: '', imports: [] } });
    const component = TestBed.createComponent(SignPageComponent).componentInstance;
    component.context.set(signerView());
    component.stepId.set('review');

    component.openDocument(1);
    expect(component.activeDocument()?.documentId).toBe('doc-1');

    component.next();

    expect(component.stepId()).toBe('review');
    expect(component.activeDocument()?.documentId).toBe('doc-2');
    expect(component.nextLabel()).toBe('Continue to signing');

    component.next();

    expect(component.stepId()).toBe('sign');
    expect(component.activeDocument()?.documentId).toBe('doc-1');
  });

  it('loads the PDF when a completed verification gate lands directly on review', () => {
    const api = {
      getDocumentBytes: vi.fn(() => of(new Uint8Array())),
      sign: vi.fn(() => of(undefined)),
    };
    TestBed.configureTestingModule({
      imports: [SignPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'token' } } } },
        { provide: PublicSignatureService, useValue: api },
      ],
    });
    TestBed.overrideComponent(SignPageComponent, { set: { template: '', imports: [] } });
    const component = TestBed.createComponent(SignPageComponent).componentInstance;
    component.stepId.set('verify-otp');
    (component as unknown as { token: string }).token = 'token';

    (
      component as unknown as {
        applyContext: (context: PublicSignerView) => void;
      }
    ).applyContext({
      ...signerView(),
      requiredVerificationMethod: 'EmailOtp',
      isVerificationCompleted: true,
    });

    expect(component.stepId()).toBe('review');
    expect(api.getDocumentBytes).toHaveBeenCalledWith('token', 'doc-1');
  });

  it('keeps the ten-second completion countdown and redirects automatically', () => {
    vi.useFakeTimers();
    try {
      const api = {
        getDocumentBytes: vi.fn(() => of(new Uint8Array())),
        sign: vi.fn(() => of(undefined)),
      };
      TestBed.configureTestingModule({
        imports: [SignPageComponent],
        providers: [
          {
            provide: ActivatedRoute,
            useValue: { snapshot: { paramMap: { get: () => 'token' } } },
          },
          { provide: PublicSignatureService, useValue: api },
        ],
      });
      TestBed.overrideComponent(SignPageComponent, { set: { template: '', imports: [] } });
      const component = TestBed.createComponent(SignPageComponent).componentInstance;
      const redirect = vi.spyOn(component, 'exitToTenant').mockImplementation(() => undefined);
      Object.defineProperty(component, 'tenantReturnUrl', {
        value: () => 'https://office.taxproffice.com/',
      });

      (
        component as unknown as {
          startDoneCountdown: () => void;
        }
      ).startDoneCountdown();

      expect(component.doneRedirectSecondsLeft()).toBe(10);
      vi.advanceTimersByTime(1_000);
      expect(component.doneRedirectSecondsLeft()).toBe(9);
      vi.advanceTimersByTime(9_000);
      expect(redirect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
