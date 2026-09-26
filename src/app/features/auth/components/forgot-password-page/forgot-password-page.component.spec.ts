import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { TenantResolutionService } from '@core/auth/tenant-resolution.service';
import { ApiConfigService } from '@core/config/api-config.service';
import { environment } from '@env/environment';
import { ForgotPasswordPageComponent } from './forgot-password-page.component';

describe('ForgotPasswordPageComponent', () => {
  function create(query: Record<string, string>, officeFromHost: string | null = null) {
    const forgotPassword = vi.fn(() => of(undefined));
    TestBed.configureTestingModule({
      imports: [ForgotPasswordPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { forgotPassword } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: TenantResolutionService, useValue: { currentOfficeName: () => of('CoreTaxPro') } },
      ],
    });
    vi.spyOn(TestBed.inject(ApiConfigService), 'officeFromHost').mockReturnValue(officeFromHost);
    const fixture = TestBed.createComponent(ForgotPasswordPageComponent);
    return { fixture, component: fixture.componentInstance, forgotPassword };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('desde el login del staff resetea la cuenta del espacio de trabajo', () => {
    const { component, forgotPassword } = create({});
    component.email.set('ana@example.com');

    component.sendCode();

    expect(forgotPassword).toHaveBeenCalledWith('ana@example.com', 'Staff');
    expect(component.step()).toBe('sent');
  });

  it('desde el login de clientes resetea la cuenta del portal', () => {
    const { component, forgotPassword } = create({ account: 'portal' });
    component.email.set('ana@example.com');

    component.sendCode();

    expect(forgotPassword).toHaveBeenCalledWith('ana@example.com', 'Portal');
  });

  it('en la dirección de una oficina nombra la oficina y enlaza a la entrada general', () => {
    const { fixture } = create({}, 'coretaxpro');

    fixture.detectChanges();

    const page: HTMLElement = fixture.nativeElement;
    expect(page.textContent).toContain('Enter the email you use at CoreTaxPro');
    const main = page.querySelector<HTMLAnchorElement>(`a[href="https://app.${environment.baseDomain}/forgot-password"]`);
    expect(main?.textContent).toContain('Reset from the main sign-in');
  });

  it('en la entrada general no ofrece otra entrada', () => {
    const { fixture } = create({});

    fixture.detectChanges();

    const page: HTMLElement = fixture.nativeElement;
    expect(page.textContent).not.toContain('Reset from the main sign-in');
  });
});
