import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { ClientProfilePortalComponent } from './client-profile-portal.component';
import { ClientPortalStore } from '../../data-access/client-portal.store';
import { ClientPortalService } from '../../data-access/client-portal.service';
import { ClientPermissions } from '../../data-access/client-permissions';
import { PermissionService } from '@core/auth/permission.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CustomerDocumentAccessPermissions } from '@features/customer-access/data-access/customer-document-access.permissions';
import { HttpErrorResponse } from '@angular/common/http';

// Pestaña "Portal access": estado del segundo factor del cliente y reset cuando perdió el teléfono.
describe('ClientProfilePortalComponent · two-step verification', () => {
  const status = signal<'active' | 'pending' | 'not-invited'>('active');
  let service: { getPortalMfa: ReturnType<typeof vi.fn>; resetPortalMfa: ReturnType<typeof vi.fn> };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  const canManage = signal(true);

  function create() {
    TestBed.configureTestingModule({
      imports: [ClientProfilePortalComponent],
      providers: [
        {
          provide: ClientPortalStore,
          useValue: {
            access: computed(() => ({ status: status(), email: 'ana@example.com', portalUserId: null, pendingInvitationId: null })),
            loading: signal(false),
            error: signal(null),
            load: vi.fn(),
            refresh: vi.fn(),
          },
        },
        { provide: ClientPortalService, useValue: service },
        { provide: ClientPermissions, useValue: { canInvitePortal: signal(true), canManage } },
        { provide: PermissionService, useValue: { has: () => true, isAdmin: () => true } },
        { provide: CustomerDocumentAccessPermissions, useValue: { canManage: signal(false) } },
        { provide: ToastService, useValue: toast },
      ],
    });
    const fixture = TestBed.createComponent(ClientProfilePortalComponent);
    fixture.componentRef.setInput('clientId', 'c1');
    fixture.componentRef.setInput('clientName', 'Ana Client');
    fixture.detectChanges();
    return fixture;
  }

  const text = (fixture: ReturnType<typeof create>) => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(() => {
    TestBed.resetTestingModule();
    status.set('active');
    canManage.set(true);
    service = {
      getPortalMfa: vi.fn(() => of({ hasPortalAccount: true, mfaEnabled: true, requiredByPolicy: false })),
      resetPortalMfa: vi.fn(() => of({ outcome: 'Reset' })),
    };
    toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  });

  it('con acceso activo muestra si lo tiene y ofrece el reset a quien gestiona clientes', () => {
    const fixture = create();

    expect(service.getPortalMfa).toHaveBeenCalledWith('c1');
    expect(text(fixture)).toContain('Two-step verification');
    expect(text(fixture)).toContain('Reset two-step verification');
  });

  it('sin acceso activo no pide el estado', () => {
    status.set('pending');
    create();

    expect(service.getPortalMfa).not.toHaveBeenCalled();
  });

  it('sin permiso de gestionar clientes no hay botón de reset', () => {
    canManage.set(false);
    const fixture = create();

    expect(text(fixture)).not.toContain('Reset two-step verification');
  });

  it('el reset pide confirmación, avisa y recarga el estado', () => {
    const fixture = create();
    const cmp = fixture.componentInstance;
    service.getPortalMfa.mockReturnValue(of({ hasPortalAccount: true, mfaEnabled: false, requiredByPolicy: false }));

    cmp.mfaConfirmOpen.set(true);
    expect(service.resetPortalMfa).not.toHaveBeenCalled();
    cmp.resetMfa();

    expect(service.resetPortalMfa).toHaveBeenCalledWith('c1');
    expect(toast.success).toHaveBeenCalledWith('Two-step verification was reset for Ana Client.');
    expect(cmp.mfa()?.mfaEnabled).toBe(false);
  });

  it('un rechazo del servidor llega con su motivo', () => {
    service.resetPortalMfa.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'Auth.NoPortalAccount', message: "This client doesn't have portal access yet." },
          }),
      ),
    );
    const fixture = create();

    fixture.componentInstance.resetMfa();

    expect(toast.error).toHaveBeenCalledWith("This client doesn't have portal access yet.");
  });
});
