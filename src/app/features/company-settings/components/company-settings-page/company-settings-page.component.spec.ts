import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminCapabilities } from '@core/access/admin-capabilities';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { CompanyProfile } from '../../data-access/company-settings.model';
import { CompanySettingsStore } from '../../data-access/company-settings.store';
import { CompanySettingsPageComponent } from './company-settings-page.component';

/** Lógica de la página: cambios sin guardar, chequeo "listo para facturar" y permisos. */
describe('CompanySettingsPageComponent', () => {
  const SAVED: CompanyProfile = {
    name: 'Castillo Tax Services LLC',
    taxId: '12-3456789',
    line1: '1600 Main St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    country: 'US',
    phone: '+1 202 555 0112',
    email: 'office@castillotax.com',
    website: null,
  };

  function setup(profile: CompanyProfile | null, canManage = true) {
    const store = {
      profile: signal(profile),
      profileLoading: signal(false),
      profileSaving: signal(false),
      profileError: signal<string | null>(null),
      surface: signal('Crm'),
      brandLoading: signal(false),
      brandError: signal<string | null>(null),
      logo: signal(null),
      favicon: signal(null),
      assetBusy: signal(null),
      assetProcessing: signal(null),
      assetError: signal<string | null>(null),
      loadAll: vi.fn(),
      saveProfile: vi.fn(() => of(void 0)),
    };
    TestBed.configureTestingModule({
      imports: [CompanySettingsPageComponent],
      providers: [
        { provide: CompanySettingsStore, useValue: store },
        {
          provide: AdminCapabilities,
          useValue: { canManageIssuerProfile: signal(canManage), canManageBranding: signal(canManage) },
        },
        { provide: AuthService, useValue: { currentUser: signal({ tenant: { name: 'Nexora' } }) } },
        { provide: ToastService, useValue: { success: vi.fn(), info: vi.fn() } },
      ],
    });
    // Solo la lógica: la plantilla se prueba en vivo.
    TestBed.overrideComponent(CompanySettingsPageComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(CompanySettingsPageComponent);
    fixture.detectChanges();
    return { page: fixture.componentInstance, store };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('recién cargado no hay cambios ni se puede guardar', () => {
    const { page } = setup(SAVED);

    expect(page.profileDirty()).toBe(false);
    expect(page.canSaveProfile()).toBe(false);
  });

  it('editar un campo marca cambios y guarda lo normalizado', () => {
    const { page, store } = setup(SAVED);

    page.website.set('  https://castillotax.com ');
    expect(page.profileDirty()).toBe(true);

    page.saveProfile();

    expect(store.saveProfile).toHaveBeenCalledWith({ ...SAVED, website: 'https://castillotax.com' });
  });

  it('descartar vuelve a lo guardado', () => {
    const { page } = setup(SAVED);
    page.city.set('Dallas');

    page.discardProfile();

    expect(page.city()).toBe('Austin');
    expect(page.profileDirty()).toBe(false);
  });

  it('sin nombre de oficina no se puede guardar aunque haya cambios', () => {
    const { page } = setup(SAVED);

    page.companyName.set('   ');

    expect(page.profileDirty()).toBe(true);
    expect(page.canSaveProfile()).toBe(false);
  });

  it('el chequeo cuenta solo lo que ya está guardado', () => {
    const { page } = setup({ ...SAVED, taxId: null, phone: null });

    expect(page.readinessScore()).toBe(50);
    expect(page.readinessChecks().filter(c => !c.done).map(c => c.id)).toEqual(['ein', 'contact']);

    page.ein.set('12-3456789'); // escrito pero sin guardar: todavía no cuenta
    expect(page.readinessScore()).toBe(50);
  });

  it('quien no gestiona la facturación no puede guardar', () => {
    const { page } = setup(SAVED, false);
    page.website.set('https://castillotax.com');

    expect(page.canEditProfile()).toBe(false);
    expect(page.canSaveProfile()).toBe(false);
  });
});
