import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { SegmentedComponent } from '@shared/ui/segmented/segmented.component';
import { CheckRingComponent, CheckRingItem } from '@shared/ui/check-ring/check-ring.component';
import { observeActiveSection, scrollToSection } from '@shared/utils/scroll-spy.util';
import { AuthService } from '@core/auth/auth.service';
import { AdminCapabilities } from '@core/access/admin-capabilities';
import { ToastService } from '@shared/ui/toast/toast.service';
import {
  ASSET_ALLOWED_CONTENT_TYPES,
  ASSET_MAX_SIZE_BYTES,
  BRAND_SURFACES,
  BrandSurface,
  CompanyProfile,
} from '../../data-access/company-settings.model';
import { CompanySettingsStore } from '../../data-access/company-settings.store';
import { BrandAssetTileComponent } from '../../ui/brand-asset-tile/brand-asset-tile.component';

type AssetKey = 'logo' | 'favicon';

interface SettingsSection {
  id: string;
  label: string;
  icon: string;
}

/**
 * Office Settings: identidad legal de la firma (Billing, `/billing/issuer-profile`) + marca por
 * superficie (TenantBrands: logo y favicon del CRM y del portal). Mismo esqueleto que Profile:
 * cabecera con chequeo hecho con datos reales, índice lateral que sigue el scroll y secciones.
 *
 * Identidad y dirección se guardan juntas (es un solo PUT), por eso la barra de guardado es una sola y
 * aparece únicamente con cambios. Quien no tiene `invoicing.issuer.manage` ve los datos en lectura.
 */
@Component({
  selector: 'app-company-settings-page',
  imports: [InfinityLoaderComponent, CommonModule, FormsModule, SegmentedComponent, CheckRingComponent, BrandAssetTileComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './company-settings-page.component.html',
  styleUrl: './company-settings-page.component.css',
})
export class CompanySettingsPageComponent {
  /**
   * B6 — el perfil legal pide `invoicing.issuer.manage` (permiso propio) y la marca, `branding.manage`.
   */
  protected readonly can = inject(AdminCapabilities);
  readonly store = inject(CompanySettingsStore);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  readonly assetMaxSizeKb = Math.round(ASSET_MAX_SIZE_BYTES / 1024);
  readonly surfaces = BRAND_SURFACES.map(s => ({ id: s.value, label: s.label }));

  // --- Formulario del perfil (espejo editable de store.profile) ---
  readonly companyName = signal('');
  readonly ein = signal('');
  readonly phone = signal('');
  readonly email = signal('');
  readonly website = signal('');
  readonly addressLine = signal('');
  readonly city = signal('');
  readonly state = signal('');
  readonly zip = signal('');
  readonly country = signal('US');

  /** Error de validación local del archivo (tipo/tamaño), previo a tocar el backend. */
  readonly assetFileError = signal<string | null>(null);

  readonly canEditProfile = computed(() => this.can.canManageIssuerProfile() && !this.store.profileLoading());

  /** Nombre para la cabecera: el guardado, o el de la oficina de la sesión mientras no hay perfil. */
  readonly officeName = computed(
    () => this.store.profile()?.name || this.auth.currentUser()?.tenant?.name || 'Office settings',
  );

  // ---------------------------------------------------------------------------
  // Índice lateral
  // ---------------------------------------------------------------------------
  readonly sections: SettingsSection[] = [
    { id: 'identity', label: 'Business identity', icon: 'business-outline' },
    { id: 'address', label: 'Business address', icon: 'location-outline' },
    { id: 'preview', label: 'Invoice preview', icon: 'receipt-outline' },
    { id: 'brand', label: 'Logo & favicon', icon: 'color-palette-outline' },
  ];
  readonly activeSection = signal('identity');

  constructor() {
    this.store.loadAll();

    // Al llegar el perfil del backend (o tras guardar), se vuelca al formulario.
    effect(() => {
      const p = this.store.profile();
      if (p) {
        this.fillForm(p);
      }
    });

    afterNextRender(() => {
      const stop = observeActiveSection(
        this.host.nativeElement as HTMLElement,
        this.sections.map(s => s.id),
        id => this.activeSection.set(id),
      );
      this.destroyRef.onDestroy(stop);
    });
  }

  scrollTo(sectionId: string): void {
    scrollToSection(this.host.nativeElement as HTMLElement, sectionId);
    this.activeSection.set(sectionId);
  }

  // ---------------------------------------------------------------------------
  // Chequeo "listo para facturar": lo que se estampa en cada factura
  // ---------------------------------------------------------------------------
  readonly readinessChecks = computed<CheckRingItem[]>(() => {
    const p = this.store.profile();
    return [
      { id: 'name', label: 'Legal name', done: !!p?.name?.trim(), target: 'identity' },
      { id: 'ein', label: 'EIN', done: !!p?.taxId?.trim(), target: 'identity' },
      {
        id: 'address',
        label: 'Full address',
        done: !!(p?.line1?.trim() && p?.city?.trim() && p?.state?.trim() && p?.zip?.trim()),
        target: 'address',
      },
      { id: 'contact', label: 'Phone & email', done: !!(p?.phone?.trim() && p?.email?.trim()), target: 'identity' },
    ];
  });
  readonly readinessScore = computed(() => {
    const checks = this.readinessChecks();
    return Math.round((checks.filter(c => c.done).length / checks.length) * 100);
  });
  readonly readinessTone = computed<'strong' | 'good' | 'weak'>(() => {
    const score = this.readinessScore();
    return score === 100 ? 'strong' : score >= 50 ? 'good' : 'weak';
  });
  readonly readinessLabel = computed(() =>
    this.readinessTone() === 'strong'
      ? 'Ready for invoices'
      : this.readinessTone() === 'good'
        ? 'Almost ready'
        : 'Missing key details',
  );
  // ---------------------------------------------------------------------------
  // Guardado del perfil (identidad + dirección = un solo PUT)
  // ---------------------------------------------------------------------------
  private readonly formValue = computed<CompanyProfile>(() => ({
    name: this.companyName().trim(),
    taxId: this.ein().trim() || null,
    line1: this.addressLine().trim() || null,
    city: this.city().trim() || null,
    state: this.state().trim() || null,
    zip: this.zip().trim() || null,
    country: this.country().trim() || 'US',
    phone: this.phone().trim() || null,
    email: this.email().trim() || null,
    website: this.website().trim() || null,
  }));

  readonly profileDirty = computed(() => {
    const saved = this.store.profile();
    const current = this.formValue();
    if (!saved) {
      // Sin perfil guardado todavía: hay cambios en cuanto se escribe algo.
      return Object.entries(current).some(([key, value]) => key !== 'country' && !!value);
    }
    // Se comparan normalizados: vacío = null y el país vacío cuenta como US, igual que al guardar.
    return (Object.keys(current) as (keyof CompanyProfile)[]).some(
      key => (current[key] || null) !== ((saved[key] as string | null)?.trim() || (key === 'country' ? 'US' : null)),
    );
  });

  readonly nameMissing = computed(() => !this.companyName().trim());

  readonly canSaveProfile = computed(
    () => this.canEditProfile() && !this.nameMissing() && !this.store.profileSaving() && this.profileDirty(),
  );

  saveProfile(): void {
    if (!this.canSaveProfile()) {
      return;
    }
    this.store.saveProfile(this.formValue()).subscribe({
      next: () => this.toast.success('Office details saved'),
      error: () => {
        /* el mensaje ya quedó en store.profileError */
      },
    });
  }

  discardProfile(): void {
    const p = this.store.profile();
    if (p) {
      this.fillForm(p);
    } else {
      this.fillForm({
        name: '',
        taxId: null,
        line1: null,
        city: null,
        state: null,
        zip: null,
        country: 'US',
        phone: null,
        email: null,
        website: null,
      });
    }
  }

  private fillForm(p: CompanyProfile): void {
    this.companyName.set(p.name ?? '');
    this.ein.set(p.taxId ?? '');
    this.phone.set(p.phone ?? '');
    this.email.set(p.email ?? '');
    this.website.set(p.website ?? '');
    this.addressLine.set(p.line1 ?? '');
    this.city.set(p.city ?? '');
    this.state.set(p.state ?? '');
    this.zip.set(p.zip ?? '');
    this.country.set(p.country ?? 'US');
  }

  // ---------------------------------------------------------------------------
  // Vista previa de la factura (lo que el cliente ve)
  // ---------------------------------------------------------------------------
  readonly previewCityLine = computed(() =>
    [this.city().trim(), [this.state().trim(), this.zip().trim()].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
  );
  readonly previewContact = computed(() =>
    [this.phone().trim(), this.email().trim(), this.website().trim()].filter(Boolean),
  );

  // ---------------------------------------------------------------------------
  // Marca: superficie + logo/favicon (mismo flujo para los dos)
  // ---------------------------------------------------------------------------
  selectSurface(surface: BrandSurface): void {
    this.assetFileError.set(null);
    this.store.setSurface(surface);
  }

  surfaceLabel(): string {
    return this.store.surface() === 'Crm' ? 'your team' : 'your clients';
  }

  onAssetRejected(): void {
    this.assetFileError.set('Image must be a PNG, JPEG or SVG.');
  }

  uploadAsset(key: AssetKey, file: File): void {
    if (!this.can.canManageBranding() || this.store.assetBusy()) {
      return;
    }
    this.assetFileError.set(null);
    if (!ASSET_ALLOWED_CONTENT_TYPES.includes(file.type)) {
      this.assetFileError.set('Image must be a PNG, JPEG or SVG.');
      return;
    }
    if (file.size > ASSET_MAX_SIZE_BYTES) {
      this.assetFileError.set(`Image must be at most ${this.assetMaxSizeKb} KB.`);
      return;
    }
    this.store.uploadAsset(key, file).subscribe({
      next: warning => {
        this.toast.success(key === 'logo' ? 'Logo uploaded' : 'Favicon uploaded');
        // El SVG se sube igual: sirve para la app y no para el correo. El aviso lo manda el backend.
        if (warning) {
          this.toast.info(warning);
        }
      },
      error: () => {
        /* el mensaje ya quedó en store.assetError */
      },
    });
  }

  removeAsset(key: AssetKey): void {
    if (this.store.assetBusy()) {
      return;
    }
    this.assetFileError.set(null);
    this.store.removeAsset(key).subscribe({
      next: () => this.toast.success(key === 'logo' ? 'Logo removed' : 'Favicon removed'),
      error: () => {
        /* el mensaje ya quedó en store.assetError */
      },
    });
  }

  /** El logo vigente es SVG: se ve en la app pero el correo no lo renderiza. */
  readonly logoIsSvg = computed(() => this.store.logo()?.contentType === 'image/svg+xml');
}
