import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantBrandingService } from './tenant-branding.service';
import { PlatformBrandLogoComponent } from './platform-brand-logo.component';

describe('PlatformBrandLogoComponent', () => {
  let fixture: ComponentFixture<PlatformBrandLogoComponent>;
  const systemLogoUrl = signal<string | null>(null);
  const loadSystemBrandLogo = vi.fn();

  beforeEach(async () => {
    systemLogoUrl.set(null);
    loadSystemBrandLogo.mockClear();

    await TestBed.configureTestingModule({
      imports: [PlatformBrandLogoComponent],
      providers: [
        {
          provide: TenantBrandingService,
          useValue: { systemLogoUrl, loadSystemBrandLogo },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlatformBrandLogoComponent);
    fixture.detectChanges();
  });

  it('solicita la marca institucional y no usa el favicon TP como logo', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(loadSystemBrandLogo).toHaveBeenCalledOnce();
    expect(loadSystemBrandLogo).toHaveBeenCalledWith('Crm');
    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toContain('TAXPROFFICE');
  });

  it('renderiza la URL institucional devuelta por tenant branding', () => {
    systemLogoUrl.set('https://manfer.taxproffice.com/tenants/branding/assets/platform-logo?v=1');
    fixture.detectChanges();

    const logo = fixture.nativeElement.querySelector('img') as HTMLImageElement | null;
    expect(logo?.src).toBe(
      'https://manfer.taxproffice.com/tenants/branding/assets/platform-logo?v=1',
    );
    expect(logo?.alt).toBe('TaxProffice');
  });
});
