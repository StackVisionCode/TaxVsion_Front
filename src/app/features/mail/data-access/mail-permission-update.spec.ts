import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NEVER, of } from 'rxjs';
import { MailStore } from './mail.store';
import { MailService } from './mail.service';
import { MailSocketService } from './mail-socket.service';
import { MailUnreadStore } from './mail-unread.store';
import { AuthService } from '@core/auth/auth.service';
import { CloudStorageUploadService } from '@core/cloud-storage/cloud-storage-upload.service';
import { MailAccount } from './mail.model';

const account = (over: Partial<MailAccount> = {}): MailAccount => ({
  id: 'a1',
  emailAddress: 'office@contoso.com',
  providerCode: 'Graph',
  displayName: null,
  status: 'Active',
  connectedAtUtc: null,
  createdAtUtc: '2026-11-01T00:00:00Z',
  isOffice: true,
  ownerUserId: null,
  missingScopes: [],
  ...over,
});

/** Conexión activa sin un permiso nuevo (Mail.ReadWrite): se pide ampliar, no reconectar desde cero. */
describe('MailStore permission update', () => {
  let initiate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // NEVER: no redirige el navegador del test.
    initiate = vi.fn(() => NEVER);
    TestBed.configureTestingModule({
      providers: [
        MailStore,
        { provide: MailService, useValue: { initiateOAuthConnect: initiate } },
        { provide: MailSocketService, useValue: { connect: vi.fn(), on: vi.fn(() => of()) } },
        { provide: MailUnreadStore, useValue: { threads: () => 0, refresh: vi.fn(), adjustThreads: vi.fn() } },
        { provide: AuthService, useValue: { currentUser: () => null } },
        { provide: CloudStorageUploadService, useValue: {} },
      ],
    });
  });

  it('solo una cuenta activa con permisos faltantes necesita ampliarlos', () => {
    const store = TestBed.inject(MailStore);

    expect(store.needsPermissionUpdate(account({ missingScopes: ['https://graph.microsoft.com/Mail.ReadWrite'] }))).toBe(true);
    expect(store.needsPermissionUpdate(account())).toBe(false);
    expect(store.needsPermissionUpdate(account({ status: 'Error', missingScopes: ['x'] }))).toBe(false);
  });

  it('ampliar permisos reabre el consentimiento del mismo proveedor y tipo de buzón', () => {
    TestBed.inject(MailStore).updatePermissions(account({ missingScopes: ['x'] }));

    expect(initiate).toHaveBeenCalledWith('Graph', true);
  });
});
