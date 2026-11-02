import { TestBed } from '@angular/core/testing';
import { SharingPolicy } from '@core/cloud-storage/cloud-storage.model';
import { FileResponse } from '../../data-access/documents.model';
import { ShareDialogComponent } from './share-dialog.component';

/**
 * El diálogo de compartir aplica las reglas de la oficina (`GET /storage/shares/policy`) en vez de
 * números propios: vida máxima en enlaces externos, contraseña obligatoria y su largo, tope de
 * descargas y si se ofrece el secure link.
 */
describe('ShareDialogComponent · office sharing rules', () => {
  const policy: SharingPolicy = {
    allowPublicShareLinks: true,
    allowLinkOnlyExternalShares: true,
    requirePasswordOnLinkShares: true,
    defaultLifetimeDays: 5,
    maxLifetimeDays: 14,
    minPasswordLength: 10,
    maxPasswordAttempts: 5,
    maxDownloads: 3,
  };

  function create(rules: SharingPolicy | null) {
    TestBed.configureTestingModule({ imports: [ShareDialogComponent] });
    const fixture = TestBed.createComponent(ShareDialogComponent);
    fixture.componentInstance.file = { id: 'file-1', name: 'return.pdf' } as unknown as FileResponse;
    fixture.componentInstance.policy = rules;
    fixture.componentInstance.publicSharing = 'enabled';
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('caps external links at the office maximum and leaves internal ones open', () => {
    const dialog = create(policy);

    dialog.access.set('ExternalRecipients');
    const expected = new Date();
    expected.setDate(expected.getDate() + 14);
    expect(dialog.maxExpiry).toBe(
      `${expected.getFullYear()}-${`${expected.getMonth() + 1}`.padStart(2, '0')}-${`${expected.getDate()}`.padStart(2, '0')}`,
    );
    expect(dialog.expiryHint).toContain('Up to 14 days');

    dialog.access.set('TenantOnly');
    expect(dialog.maxExpiry).toBeNull();
  });

  it('requires a long enough password on link-only shares', () => {
    const dialog = create(policy);
    dialog.access.set('ExternalLink');

    expect(dialog.canSubmit).toBe(false);
    dialog.password.set('short');
    expect(dialog.passwordError).toContain('at least 10');
    dialog.password.set('long-enough-pass');
    expect(dialog.canSubmit).toBe(true);
  });

  it('rejects more opens than the office allows on external links', () => {
    const dialog = create({ ...policy, requirePasswordOnLinkShares: false });
    dialog.access.set('Public');

    dialog.maxAccess.set('4');
    expect(dialog.maxAccessError).toContain('up to 3');
    dialog.maxAccess.set('3');
    expect(dialog.canSubmit).toBe(true);
  });

  it('does not offer the secure link when the office turned it off', () => {
    const dialog = create({ ...policy, allowLinkOnlyExternalShares: false });

    expect(dialog.accessOptions.some(option => option.id === 'ExternalLink')).toBe(false);
  });

  it('invents no limits while the rules are unknown', () => {
    const dialog = create(null);
    dialog.access.set('ExternalLink');

    expect(dialog.maxExpiry).toBeNull();
    expect(dialog.passwordRequired).toBe(false);
    expect(dialog.maxDownloads).toBeNull();
  });
});
