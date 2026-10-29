import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PROFILE_PHOTO_PREPARER } from '@core/profile-photo/profile-photo-image.util';
import { PHOTO_POLL_DELAY_MS } from '@core/profile-photo/profile-photo-upload';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ClientsStore } from '../../data-access/clients.store';
import { ClientProfile } from '../../models/client-profile.model';
import { ClientPhotoEditorComponent } from './client-photo-editor.component';

function client(overrides: Partial<ClientProfile> = {}): ClientProfile {
  return {
    id: 'c1',
    type: 'individual',
    displayName: 'Ana López',
    email: 'ana@acme.test',
    phone: '',
    language: 'En',
    preferredChannel: 'Email',
    emailEnabled: true,
    smsEnabled: true,
    isActive: true,
    status: 'Active',
    createdAt: '2026-01-01',
    avatarFileId: null,
    addresses: [],
    contactPoints: [],
    relations: [],
    fiscalProfile: null,
    assignees: [],
    dependents: [],
    ...overrides,
  };
}

/**
 * Cabecera de Client 360 con la foto del cliente: cámara y acciones solo para quien puede gestionar
 * clientes; subir confirma con toast y pide recargar; quitar pide confirmación.
 */
describe('ClientPhotoEditorComponent', () => {
  let fixture: ComponentFixture<ClientPhotoEditorComponent>;
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  let detail: unknown;
  const clients = {
    uploadAvatar: vi.fn(() => of({ fileId: 'f-new', status: 'processing' })),
    deleteAvatar: vi.fn(() => of(void 0)),
    getById: vi.fn(() => of(detail)),
    afterPhotoChange: vi.fn(),
  };
  const prepared = new File(['y'], 'client.jpg', { type: 'image/jpeg' });

  beforeEach(() => {
    vi.useFakeTimers();
    detail = null;
    Object.values(toast).forEach(fn => fn.mockClear());
    Object.values(clients).forEach(fn => fn.mockClear());
    TestBed.configureTestingModule({
      imports: [ClientPhotoEditorComponent],
      providers: [
        { provide: ClientsStore, useValue: clients },
        { provide: ToastService, useValue: toast },
        { provide: PROFILE_PHOTO_PREPARER, useValue: () => Promise.resolve(prepared) },
      ],
    });
    fixture = TestBed.createComponent(ClientPhotoEditorComponent);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  function render(c: ClientProfile, canEdit: boolean) {
    fixture.componentRef.setInput('client', c);
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const buttonByText = (el: HTMLElement, text: string) =>
    Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes(text));

  it('sin permiso muestra la foto pero ningún control', () => {
    const el = render(client({ avatarFileId: 'f-1' }), false);

    expect(el.querySelector('img')?.getAttribute('src')).toContain('/storage/avatars/f-1');
    expect(el.querySelector('[aria-label="Change client photo"]')).toBeNull();
    expect(buttonByText(el, 'Remove photo')).toBeUndefined();
  });

  it('con permiso ofrece subir; con foto, cambiar y quitar', () => {
    let el = render(client(), true);
    expect(el.querySelector('[aria-label="Upload client photo"]')).not.toBeNull();
    expect(buttonByText(el, 'Upload photo')).toBeDefined();
    expect(buttonByText(el, 'Remove photo')).toBeUndefined();

    el = render(client({ avatarFileId: 'f-1' }), true);
    expect(el.querySelector('[aria-label="Change client photo"]')).not.toBeNull();
    expect(buttonByText(el, 'Change photo')).toBeDefined();
    expect(buttonByText(el, 'Remove photo')).toBeDefined();
  });

  it('subir una foto la confirma con un toast y pide recargar el detalle', async () => {
    const el = render(client(), true);
    let changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);

    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'pic.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(clients.uploadAvatar).toHaveBeenCalledWith('c1', prepared);
    expect(el.querySelector('[role="status"]')?.textContent).toContain('Checking the photo');

    detail = { avatarFileId: 'f-new', pendingAvatarFileId: null, avatarUploadStatus: null };
    await vi.advanceTimersByTimeAsync(PHOTO_POLL_DELAY_MS);

    expect(toast.success).toHaveBeenCalledWith('Client photo updated');
    expect(changed).toBe(1);
  });

  it('quitar la foto pide confirmación y luego llama al DELETE', () => {
    const el = render(client({ avatarFileId: 'f-1' }), true);
    let changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);

    buttonByText(el, 'Remove photo')!.click();
    fixture.detectChanges();
    expect(clients.deleteAvatar).not.toHaveBeenCalled();

    fixture.componentInstance.confirmRemove();

    expect(clients.deleteAvatar).toHaveBeenCalledWith('c1');
    expect(toast.success).toHaveBeenCalledWith('Client photo removed');
    expect(changed).toBe(1);
  });

  it('si la ficha llega con una foto en revisión, espera el veredicto y pide recargar', async () => {
    render(client({ avatarUploadStatus: 'processing', pendingAvatarFileId: 'f-p' }), true);
    let changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);

    detail = { avatarFileId: 'f-p', pendingAvatarFileId: null, avatarUploadStatus: null };
    await vi.advanceTimersByTimeAsync(PHOTO_POLL_DELAY_MS);

    expect(clients.getById).toHaveBeenCalledWith('c1');
    expect(changed).toBe(1);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
