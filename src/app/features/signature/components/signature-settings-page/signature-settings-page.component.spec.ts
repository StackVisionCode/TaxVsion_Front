import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AdminCapabilities } from '@core/access/admin-capabilities';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SignatureStore } from '../../data-access/signature.store';
import { SignatureCapabilities } from '../../data-access/signature-permissions';
import { SignatureSettings, SignatureSettingsUpdate } from '../../data-access/signature.model';
import { TEST_EFFECTIVE_LIMITS } from '../../testing/effective-limits.fixture';
import { SignatureSettingsPageComponent } from './signature-settings-page.component';

/**
 * F4 — los años de retención los fija la oficina en Office settings → Compliance: aquí son de solo lectura (con
 * enlace si el usuario puede abrir Cumplimiento) y el PUT ya no los manda; "Allow purge" sigue editable.
 */
describe('SignatureSettingsPageComponent — retención', () => {
  const SETTINGS: SignatureSettings = {
    allowedVerificationChannels: ['Email'],
    defaultVerificationChannel: 'Email',
    defaultTokenExpirationHours: 168,
    remindersEnabledByDefault: true,
    defaultReminderIntervalHours: 48,
    generateCertificateByDefault: true,
    allowEmployeeOwnSignature: true,
    maxPdfBytes: 25 * 1024 * 1024,
    maxPagesPerDocument: 100,
    retentionYears: 12,
    retentionYearsSource: 'Office',
    allowPurge: false,
    planConstraints: {
      maxDocumentsPerRequest: 20,
      maxSignersPerRequest: 50,
      maxAllowedPdfBytes: 25 * 1024 * 1024,
      maxAllowedPages: 100,
      minRetentionYears: 7,
      purgeAllowed: true,
      allowedChannels: ['Email', 'Sms'],
      maxTokenExpirationHours: 720,
    },
    sendPartialCopyDefault: false,
    partialCopyDefaultAudienceKind: 'All',
    sendSealedDocumentDefault: false,
    expirationEnabledByDefault: true,
    sendCertificateToSignersDefault: false,
    requiresConsentByDefault: true,
    delivery: { linkLifetimeDays: 30, allowPublicReissue: true, attachDocuments: false, maxAttachmentBytes: 10 * 1024 * 1024 },
    showSignatureFrame: true,
    dateStampFormat: 'MonthDayYear',
  };

  function setup(overrides: { settings?: Partial<SignatureSettings>; canOpenCompliance?: boolean } = {}) {
    const saved: SignatureSettingsUpdate[] = [];
    const store = {
      signatureSettings: signal<SignatureSettings | null>({ ...SETTINGS, ...overrides.settings }),
      limits: signal(TEST_EFFECTIVE_LIMITS),
      loadSignatureSettings: vi.fn(),
      loadLimits: vi.fn(),
      loadSignatureProfiles: vi.fn(),
      saveSignatureSettings: vi.fn((body: SignatureSettingsUpdate) => {
        saved.push(body);
        return of(undefined);
      }),
    };
    TestBed.configureTestingModule({
      imports: [SignatureSettingsPageComponent],
      providers: [
        provideRouter([]),
        { provide: SignatureStore, useValue: store },
        { provide: SignatureCapabilities, useValue: { canManagePreparerProfiles: signal(false) } },
        { provide: AdminCapabilities, useValue: { canManageCompliance: signal(overrides.canOpenCompliance ?? true) } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(SignatureSettingsPageComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, saved };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('muestra los años efectivos en solo lectura, sin campo editable', () => {
    const { el } = setup();

    expect(el.querySelector('[data-testid="retention-years"]')?.textContent?.trim()).toBe('12 years');
    expect(el.querySelector('input[aria-label="Retention in years"]')).toBeNull();
  });

  it('con acceso a Cumplimiento enlaza a Office settings → Compliance', () => {
    const { el } = setup();
    const link = Array.from(el.querySelectorAll('a')).find(a => a.textContent?.includes('Office settings → Compliance'));

    expect(link?.getAttribute('href')).toBe('/company/settings#compliance');
  });

  it('sin acceso a Cumplimiento lo dice como texto, sin enlace', () => {
    const { el } = setup({ canOpenCompliance: false });
    const link = Array.from(el.querySelectorAll('a')).find(a => a.textContent?.includes('Office settings → Compliance'));

    expect(link).toBeUndefined();
    expect(el.textContent).toContain('Office settings → Compliance');
  });

  it('si la oficina no la fijó, aclara que es el valor por defecto', () => {
    const { el } = setup({ settings: { retentionYearsSource: 'Signature', retentionYears: 7 } });

    expect(el.textContent).toContain('Default until your office sets it in');
  });

  it('guardar manda solo "Allow purge" y la purga sigue editable', () => {
    const { fixture, saved } = setup();

    fixture.componentInstance.patch('allowPurge', true);
    fixture.componentInstance.save();

    expect(saved.at(-1)?.retentionPolicy).toEqual({ allowPurge: true });
  });
});
