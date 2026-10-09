import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ASSET_ALLOWED_CONTENT_TYPES,
  ASSET_MAX_SIZE_BYTES,
  BRAND_SURFACES,
  BrandSurface,
} from '../../data-access/company-settings.model';
import { CompanySettingsStore } from '../../data-access/company-settings.store';
import { AdminCapabilities } from '@core/access/admin-capabilities';
import { ToastService } from '@shared/ui/toast/toast.service';

/**
 * Página del módulo Company Settings: identidad legal de la firma (Billing) + marca del tenant
 * (TenantBrands, superficie CRM): logo y favicon. Los colores (primary/accent) ya no se editan aquí:
 * la app usa el azul fijo del brandbook para todos los tenants.
 */
@Component({
  selector: 'app-company-settings-page',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './company-settings-page.component.html',
})
export class CompanySettingsPageComponent {
  /**
   * B6 — la §34 marcaba que el empleado PODÍA cambiar el emisor legal. El perfil legal pide
   * `invoicing.issuer.manage` (permiso propio) y la marca, `branding.manage`.
   */
  protected readonly can = inject(AdminCapabilities);

  readonly store = inject(CompanySettingsStore);
  private readonly toast = inject(ToastService);

  readonly assetMaxSizeKb = Math.round(ASSET_MAX_SIZE_BYTES / 1024);

  /** Superficies configurables (CRM / Portal del cliente) para el selector. */
  readonly surfaces = BRAND_SURFACES;

  /** Cambia la superficie de marca a editar (recarga su logo/favicon). */
  selectSurface(surface: BrandSurface): void {
    this.store.setSurface(surface);
  }

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

  constructor() {
    this.store.loadAll();

    // Al llegar el perfil del backend (o tras guardar), se vuelca al formulario.
    effect(() => {
      const p = this.store.profile();
      if (!p) {
        return;
      }
      this.companyName.set(p.name);
      this.ein.set(p.taxId ?? '');
      this.phone.set(p.phone ?? '');
      this.email.set(p.email ?? '');
      this.website.set(p.website ?? '');
      this.addressLine.set(p.line1 ?? '');
      this.city.set(p.city ?? '');
      this.state.set(p.state ?? '');
      this.zip.set(p.zip ?? '');
      this.country.set(p.country ?? 'US');
    });
  }

  get canSaveProfile(): boolean {
    return (
      this.companyName().trim().length > 0 &&
      !this.store.profileSaving() &&
      !this.store.profileLoading()
    );
  }

  saveProfile(): void {
    if (!this.canSaveProfile) {
      return;
    }
    this.store
      .saveProfile({
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
      })
      .subscribe({
        next: () => this.showToast('Company profile saved'),
        error: () => {
          /* el mensaje ya quedó en store.profileError */
        },
      });
  }

  // --- Assets (logo + favicon, mismo flujo) ---

  onAssetSelected(event: Event, key: 'logo' | 'favicon'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite reseleccionar el mismo archivo
    if (!file) {
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
        this.showToast(key === 'logo' ? 'Logo uploaded' : 'Favicon uploaded');
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

  removeAsset(key: 'logo' | 'favicon'): void {
    if (this.store.assetBusy()) {
      return;
    }
    this.assetFileError.set(null);
    this.store.removeAsset(key).subscribe({
      next: () => this.showToast(key === 'logo' ? 'Logo removed' : 'Favicon removed'),
      error: () => {
        /* el mensaje ya quedó en store.assetError */
      },
    });
  }

  /** El logo vigente es SVG: se ve en la app pero el correo no lo renderiza. */
  readonly logoIsSvg = computed(() => this.store.logo()?.contentType === 'image/svg+xml');

  private showToast(message: string): void {
    this.toast.success(message);
  }
}
