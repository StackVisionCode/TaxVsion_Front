import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NEVER, of } from 'rxjs';
import { CentralLoginPageComponent } from './central-login-page.component';
import { CentralLoginService } from '@core/auth/central-login.service';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { DiscoverOffice } from '@core/auth/central-login.model';
import { signal } from '@angular/core';

const office = (over: Partial<DiscoverOffice> = {}): DiscoverOffice =>
  ({
    tenantId: 't1',
    tenantName: 'CoreTaxPro',
    subdomain: 'coretaxpro',
    isClientPortal: false,
    mfaRequired: true,
    ...over,
  }) as DiscoverOffice;

// Login central con la cuenta en varias oficinas: el código se pide dentro de la lista y también ahí
// se puede marcar el dispositivo como de confianza (antes solo existía en la vista de una oficina).
describe('CentralLoginPageComponent · varias oficinas con segundo factor', () => {
  let central: { discover: ReturnType<typeof vi.fn>; handoff: ReturnType<typeof vi.fn> };

  function selectStep() {
    central = {
      discover: vi.fn(() =>
        of({ kind: 'select', sessionRef: 'ref-1', offices: [office(), office({ tenantId: 't2', tenantName: 'Castillo', mfaRequired: false })] }),
      ),
      // El vale nunca llega: el test no navega fuera de la página.
      handoff: vi.fn(() => NEVER),
    };
    TestBed.configureTestingModule({
      imports: [CentralLoginPageComponent],
      providers: [
        provideRouter([]),
        { provide: CentralLoginService, useValue: central },
        { provide: TenantBrandingService, useValue: { applyForSystem: vi.fn(), logoUrl: signal(null) } },
      ],
    });
    const fixture = TestBed.createComponent(CentralLoginPageComponent);
    const cmp = fixture.componentInstance;
    cmp.form.setValue({ ...cmp.form.getRawValue(), email: 'ana@example.com', password: 'Secret123' });
    cmp.submitCredentials();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('al abrir el código de una oficina ofrece no volver a pedirlo en este dispositivo', () => {
    const fixture = selectStep();
    const cmp = fixture.componentInstance;

    cmp.chooseOffice(cmp.offices()[0]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Enter your verification code');
    expect(el.textContent).toContain("Don't ask for a code on this device again");
  });

  it('la casilla marcada viaja en el canje de esa oficina', () => {
    const fixture = selectStep();
    const cmp = fixture.componentInstance;
    cmp.chooseOffice(cmp.offices()[0]);
    fixture.detectChanges();

    const checkbox = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('li input[type="checkbox"]')!;
    checkbox.click();
    cmp.mfaCode.set('821544');
    cmp.submitMfa(cmp.offices()[0]);

    expect(central.handoff).toHaveBeenCalledWith('ref-1', 't1', '821544', 'Staff', true);
  });

  it('cancelar y abrir otra oficina vuelve a empezar sin la casilla marcada', () => {
    const fixture = selectStep();
    const cmp = fixture.componentInstance;
    cmp.chooseOffice(cmp.offices()[0]);
    cmp.toggleRememberDevice();

    cmp.cancelMfa();
    cmp.chooseOffice(cmp.offices()[0]);

    expect(cmp.rememberDevice()).toBe(false);
  });
});
