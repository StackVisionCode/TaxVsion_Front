import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PermissionService } from '@core/auth/permission.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { StorageSettingsService } from '../../data-access/storage-settings.service';
import { PortalUploadsSettingComponent } from './portal-uploads-setting.component';

describe('PortalUploadsSettingComponent', () => {
  function create() {
    TestBed.configureTestingModule({
      imports: [PortalUploadsSettingComponent],
      providers: [
        { provide: PermissionService, useValue: { has: () => false } },
        { provide: StorageSettingsService, useValue: { getPortalUploads: vi.fn(() => of(null)) } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
    return TestBed.createComponent(PortalUploadsSettingComponent).componentInstance;
  }

  it('shows catalog group codes as readable text', () => {
    const component = create();
    expect(component.groupLabel('rich_text')).toBe('Rich text');
    expect(component.groupLabel('web_images')).toBe('Web images');
    expect(component.groupLabel('xml')).toBe('XML');
    expect(component.groupLabel('documents')).toBe('Documents');
  });
});
