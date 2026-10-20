import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '@core/auth/auth.service';
import { ApiConfigService } from '@core/config/api-config.service';
import { TenantBrandingService } from '@core/theme/tenant-branding.service';
import { PasswordResetValidation } from '@core/auth/auth.model';
import { ResetPasswordPageComponent } from './reset-password-page.component';

const invalidLink = () =>
  throwError(
    () =>
      new HttpErrorResponse({
        status: 401,
        error: { code: 'Auth.InvalidResetToken', message: 'Reset token is invalid or expired.' },
      }),
  );

const valid: PasswordResetValidation = { status: 'Valid', tenant: null };
const invalid: PasswordResetValidation = { status: 'Invalid', tenant: null };

describe('ResetPasswordPageComponent', () => {
  function create(
    query: Record<string, string>,
    validation: () => Observable<PasswordResetValidation>,
  ) {
    const validateResetToken = vi.fn(validation);
    const resetPassword = vi.fn(() => of(undefined));
    const api = { setSlug: vi.fn() } as unknown as ApiConfigService;
    const branding = {
      applyForSurface: vi.fn(),
      logoUrl: signal<string | null>(null),
    } as unknown as TenantBrandingService;
    TestBed.configureTestingModule({
      imports: [ResetPasswordPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { validateResetToken, resetPassword } },
        { provide: ApiConfigService, useValue: api },
        { provide: TenantBrandingService, useValue: branding },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
        },
      ],
    });
    const fixture = TestBed.createComponent(ResetPasswordPageComponent);
    fixture.detectChanges();
    const page: HTMLElement = fixture.nativeElement;
    return {
      fixture,
      component: fixture.componentInstance,
      page,
      validateResetToken,
      resetPassword,
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('sin token avisa que el enlace es inválido sin consultar al backend', () => {
    const { page, validateResetToken } = create({}, () => of(valid));

    expect(page.textContent).toContain('Invalid link');
    expect(validateResetToken).not.toHaveBeenCalled();
  });

  it('con un enlace vigente muestra el formulario', () => {
    const { page, validateResetToken } = create({ token: 'raw-1' }, () => of(valid));

    expect(validateResetToken).toHaveBeenCalledWith('raw-1');
    expect(page.querySelector('#password')).not.toBeNull();
  });

  it('con un enlace que ya no sirve avisa sin pedir la contraseña', () => {
    const { page } = create({ token: 'raw-1' }, () => of(invalid));

    expect(page.textContent).toContain('This link no longer works');
    expect(page.querySelector('#password')).toBeNull();
  });

  it('un rechazo con Auth.InvalidResetToken también lleva al aviso', () => {
    const { page } = create({ token: 'raw-1' }, invalidLink);

    expect(page.textContent).toContain('This link no longer works');
    expect(page.querySelector('#password')).toBeNull();
  });

  it('si no se pudo comprobar el enlace, deja el formulario', () => {
    const { page } = create({ token: 'raw-1' }, () =>
      throwError(() => new HttpErrorResponse({ status: 0 })),
    );

    expect(page.querySelector('#password')).not.toBeNull();
  });

  it('si el enlace deja de servir al enviar, pasa al aviso', () => {
    const { fixture, component, page, resetPassword } = create({ token: 'raw-1' }, () => of(valid));
    resetPassword.mockImplementation(invalidLink);
    component.password.set('a-brand-new-passphrase');
    component.confirmPassword.set('a-brand-new-passphrase');

    component.resetPassword();
    fixture.detectChanges();

    expect(page.textContent).toContain('This link no longer works');
  });
});
