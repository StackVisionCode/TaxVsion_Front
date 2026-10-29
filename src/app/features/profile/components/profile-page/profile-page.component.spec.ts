import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { MeResponse } from '@core/auth/auth.model';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ProfileStore } from '../../data-access/profile.store';
import { PhotoStatus } from '../../data-access/profile.model';
import { ProfileMfaStore } from '../../data-access/mfa.store';
import { TwoStepVerificationComponent } from '../../ui/two-step-verification/two-step-verification.component';
import { ProfilePageComponent } from './profile-page.component';

describe('ProfilePageComponent · teléfono sin OTP', () => {
  let fixture: ComponentFixture<ProfilePageComponent>;
  let component: ProfilePageComponent;
  let el: HTMLElement;
  const currentUser = signal<MeResponse | null>(null);
  const updatePhone = vi.fn();
  const toast = { success: vi.fn(), error: vi.fn() };

  function user(phoneNumber: string | null): MeResponse {
    return {
      name: 'Ana',
      lastName: 'Diaz',
      email: 'ana@example.com',
      emailVerified: true,
      phoneNumber,
      phoneVerified: false,
      actorType: 'TenantEmployee',
    } as unknown as MeResponse;
  }

  function phoneRow(): HTMLElement {
    return el.querySelector('ion-icon[name="call-outline"]')!.closest('.p-4') as HTMLElement;
  }

  beforeEach(() => {
    updatePhone.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    currentUser.set(user(null));

    TestBed.configureTestingModule({
      imports: [ProfilePageComponent],
      providers: [
        { provide: AuthService, useValue: { currentUser } },
        {
          provide: ProfileStore,
          useValue: {
            sessions: signal([]),
            sessionsLoading: signal(false),
            sessionsError: signal(null),
            currentSessionId: signal(null),
            loadSessions: vi.fn(),
            updatePhone,
            photoStatus: signal('idle'),
            photoBusy: signal(false),
            photoError: signal(null),
            resumePendingPhoto: vi.fn(),
          },
        },
        { provide: ProfileMfaStore, useValue: { enabled: signal(false), loaded: signal(true) } },
        { provide: ToastService, useValue: toast },
      ],
    });
    // La tarjeta de MFA tiene su propio store y no es parte de este flujo.
    TestBed.overrideComponent(ProfilePageComponent, { remove: { imports: [TwoStepVerificationComponent] } });
    fixture = TestBed.createComponent(ProfilePageComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('sin teléfono: "Not added", botón "Add phone" y el check de seguridad pendiente', () => {
    expect(phoneRow().textContent).toContain('Not added');
    expect(phoneRow().textContent).toContain('Add phone');
    expect(phoneRow().textContent).not.toContain('Verified');
    expect(component.securityChecks().find(c => c.id === 'phone')).toMatchObject({
      label: 'Phone number added',
      done: false,
    });
  });

  it('con teléfono: muestra el número, badge "Added", botón "Change" y el check hecho (sin verificación)', () => {
    currentUser.set(user('+1 202 555 0112'));
    fixture.detectChanges();
    const text = phoneRow().textContent ?? '';
    expect(text).toContain('+1 202 555 0112');
    expect(text).toContain('Added');
    expect(text).toContain('Change');
    expect(text).not.toMatch(/Unverified|Verified/);
    expect(component.securityChecks().find(c => c.id === 'phone')?.done).toBe(true);
  });

  it('editar precarga el número actual y no hay paso de código', () => {
    currentUser.set(user('5550112'));
    component.startPhoneChange();
    fixture.detectChanges();
    expect(component.newPhone()).toBe('5550112');
    expect(el.querySelector('input[name="newPhone"]')).toBeTruthy();
    expect(el.querySelector('input[name="phoneCode"]')).toBeNull();
    expect(phoneRow().textContent).not.toMatch(/code/i);
  });

  it('Save hace un solo guardado, cierra y avisa "Phone number saved"', () => {
    updatePhone.mockReturnValue(of(void 0));
    component.startPhoneChange();
    component.newPhone.set('  +1 202 555 0112 ');
    component.savePhone();
    expect(updatePhone).toHaveBeenCalledExactlyOnceWith('+1 202 555 0112');
    expect(component.phoneEditing()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Phone number saved');
  });

  it('valida en cliente con la regla del backend y no llama al servidor', () => {
    component.startPhoneChange();
    component.newPhone.set('(202) 555');
    component.savePhone();
    expect(updatePhone).not.toHaveBeenCalled();
    expect(component.phoneError()).toContain('valid phone number');
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('valid phone number');
  });

  it('muestra en línea el mensaje del 400 del backend', () => {
    updatePhone.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'User.Phone', message: 'Phone number is invalid.' },
          }),
      ),
    );
    component.startPhoneChange();
    component.newPhone.set('5550112');
    component.savePhone();
    fixture.detectChanges();
    expect(component.phoneEditing()).toBe(true);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Phone number is invalid.');
  });

  it('"Remove phone" solo aparece con número y pide confirmación antes de quitarlo', () => {
    component.startPhoneChange();
    fixture.detectChanges();
    expect(phoneRow().textContent).not.toContain('Remove phone');

    currentUser.set(user('5550112'));
    fixture.detectChanges();
    const remove = Array.from(phoneRow().querySelectorAll('button')).find(b =>
      b.textContent?.includes('Remove phone'),
    )!;
    remove.click();
    fixture.detectChanges();
    expect(component.removePhoneOpen()).toBe(true);
    expect(updatePhone).not.toHaveBeenCalled();
  });

  it('confirmar la baja manda null, cierra todo y avisa "Phone number removed"', () => {
    const result = new Subject<void>();
    updatePhone.mockReturnValue(result);
    currentUser.set(user('5550112'));
    component.startPhoneChange();
    component.removePhoneOpen.set(true);
    component.confirmRemovePhone();
    expect(updatePhone).toHaveBeenCalledExactlyOnceWith(null);
    expect(component.phoneBusy()).toBe(true);

    result.next();
    result.complete();
    expect(component.removePhoneOpen()).toBe(false);
    expect(component.phoneEditing()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Phone number removed');
  });
});

describe('ProfilePageComponent · foto de perfil', () => {
  let fixture: ComponentFixture<ProfilePageComponent>;
  let component: ProfilePageComponent;
  let el: HTMLElement;
  const currentUser = signal<MeResponse | null>(null);
  const photoStatus = signal<PhotoStatus>('idle');
  const photoError = signal<string | null>(null);
  const uploadPhoto = vi.fn();
  const removePhoto = vi.fn();
  const resumePendingPhoto = vi.fn();
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

  function user(avatarFileId: string | null): MeResponse {
    return {
      name: 'Ana',
      lastName: 'Diaz',
      email: 'ana@example.com',
      emailVerified: true,
      phoneNumber: null,
      actorType: 'TenantEmployee',
      avatarFileId,
      avatarPending: false,
    } as unknown as MeResponse;
  }

  const buttons = () => Array.from(el.querySelectorAll('button'));
  const button = (text: string) => buttons().find(b => b.textContent?.trim().startsWith(text));
  const header = () => el.querySelector('section[aria-label="Your account"]') as HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser.set(user(null));
    photoStatus.set('idle');
    photoError.set(null);

    TestBed.configureTestingModule({
      imports: [ProfilePageComponent],
      providers: [
        { provide: AuthService, useValue: { currentUser } },
        {
          provide: ProfileStore,
          useValue: {
            sessions: signal([]),
            sessionsLoading: signal(false),
            sessionsError: signal(null),
            currentSessionId: signal(null),
            loadSessions: vi.fn(),
            photoStatus,
            photoBusy: computed(() => photoStatus() !== 'idle'),
            photoError,
            uploadPhoto,
            removePhoto,
            resumePendingPhoto,
          },
        },
        { provide: ProfileMfaStore, useValue: { enabled: signal(false), loaded: signal(true) } },
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.overrideComponent(ProfilePageComponent, { remove: { imports: [TwoStepVerificationComponent] } });
    fixture = TestBed.createComponent(ProfilePageComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('sin foto: iniciales, "Upload photo" y sin "Remove photo"; retoma un escaneo pendiente', () => {
    expect(header().querySelector('app-avatar img')).toBeNull();
    expect(header().querySelector('app-avatar')?.textContent).toContain('AD');
    expect(button('Upload photo')).toBeTruthy();
    expect(button('Remove photo')).toBeUndefined();
    expect(header().querySelector('button[aria-label="Upload profile photo"]')).toBeTruthy();
    expect(resumePendingPhoto).toHaveBeenCalledOnce();
  });

  it('con foto: muestra la imagen de /storage/avatars/{id}, "Change photo" y "Remove photo"', () => {
    currentUser.set(user('f-1'));
    fixture.detectChanges();

    const img = header().querySelector('app-avatar img') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/\/storage\/avatars\/f-1$/);
    expect(button('Change photo')).toBeTruthy();
    expect(button('Remove photo')).toBeTruthy();
  });

  it('elegir un archivo lo sube y avisa "Profile photo updated" al confirmarse', () => {
    uploadPhoto.mockReturnValue(of('updated'));
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    input.dispatchEvent(new Event('change'));

    expect(uploadPhoto).toHaveBeenCalledExactlyOnceWith(file);
    expect(toast.success).toHaveBeenCalledWith('Profile photo updated');
  });

  it('si el escaneo la descarta avisa con el mensaje de fallo; si tarda, informa que sigue en revisión', () => {
    uploadPhoto.mockReturnValue(of('failed'));
    component.onPhotoDropped([new File(['x'], 'a.png', { type: 'image/png' })]);
    expect(toast.error).toHaveBeenCalledWith("We couldn't use that photo. Try another image.");

    uploadPhoto.mockReturnValue(of('timeout'));
    component.onPhotoDropped([new File(['x'], 'b.png', { type: 'image/png' })]);
    expect(toast.info).toHaveBeenCalledWith('Your photo is still being checked. It will appear shortly.');
  });

  it('mientras procesa: overlay, controles deshabilitados y estado anunciado', () => {
    photoStatus.set('processing');
    fixture.detectChanges();

    expect(header().querySelector('[role="status"]')?.textContent).toContain('Checking your photo');
    expect(button('Upload photo')?.disabled).toBe(true);
    expect((header().querySelector('button[aria-label="Upload profile photo"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('el error del backend se muestra en línea', () => {
    uploadPhoto.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400 })));
    photoError.set('The image must be at least 64x64 pixels.');
    component.onPhotoDropped([new File(['x'], 'a.png', { type: 'image/png' })]);
    fixture.detectChanges();

    expect(header().querySelector('[role="alert"]')?.textContent).toContain('The image must be at least 64x64 pixels.');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('"Remove photo" pide confirmación y al confirmar quita la foto', () => {
    removePhoto.mockReturnValue(of(void 0));
    currentUser.set(user('f-1'));
    fixture.detectChanges();

    button('Remove photo')!.click();
    fixture.detectChanges();
    expect(component.removePhotoOpen()).toBe(true);
    expect(removePhoto).not.toHaveBeenCalled();

    component.confirmRemovePhoto();
    expect(removePhoto).toHaveBeenCalledOnce();
    expect(component.removePhotoOpen()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Profile photo removed');
  });
});
