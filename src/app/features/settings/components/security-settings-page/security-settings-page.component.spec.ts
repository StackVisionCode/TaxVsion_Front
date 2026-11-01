import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { SecuritySettingsPageComponent } from './security-settings-page.component';
import { MfaPolicy, MfaPolicyService } from '../../data-access/mfa-policy.service';
import { ToastService } from '@shared/ui/toast/toast.service';

const policy: MfaPolicy = {
  requireForAdmins: true,
  requireForEmployees: false,
  requireForCustomerPortal: false,
  trustedDeviceDays: 45,
};

// Settings → Security: la oficina decide a quién exige el segundo factor.
describe('SecuritySettingsPageComponent', () => {
  let service: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  function create(): SecuritySettingsPageComponent {
    TestBed.configureTestingModule({
      imports: [SecuritySettingsPageComponent],
      providers: [
        provideRouter([]),
        { provide: MfaPolicyService, useValue: service },
        { provide: ToastService, useValue: toast },
      ],
    });
    const fixture = TestBed.createComponent(SecuritySettingsPageComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    service = { get: vi.fn(() => of(policy)), update: vi.fn(() => of(void 0)) };
    toast = { success: vi.fn(), error: vi.fn() };
  });

  it('carga la política, conserva un valor de días poco común y no hay cambios que guardar', () => {
    const page = create();

    expect(page.draft()).toEqual({ requireForEmployees: false, requireForCustomerPortal: false, trustedDeviceDays: 45 });
    expect(page.dayOptions()).toContain(45);
    expect(page.dirty()).toBe(false);
  });

  it('exigirlo al portal y guardar manda solo lo editable', () => {
    const page = create();

    page.set('requireForCustomerPortal', true);
    expect(page.dirty()).toBe(true);
    page.save();

    expect(service.update).toHaveBeenCalledWith({ requireForEmployees: false, requireForCustomerPortal: true, trustedDeviceDays: 45 });
    expect(page.dirty()).toBe(false);
    expect(toast.success).toHaveBeenCalled();
  });

  it('descartar vuelve a lo guardado', () => {
    const page = create();
    page.set('requireForEmployees', true);
    page.onDaysChange('7');

    page.discard();

    expect(page.dirty()).toBe(false);
  });

  it('si no se puede cargar, lo dice con reintento', () => {
    service.get.mockReturnValue(throwError(() => new Error('boom')));
    const page = create();

    expect(page.error()).toBeTruthy();
    expect(page.loading()).toBe(false);
  });
});
