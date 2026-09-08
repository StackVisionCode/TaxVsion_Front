import { Component, CUSTOM_ELEMENTS_SCHEMA, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '@core/theme/theme.service';
import {
  ASSET_ALLOWED_CONTENT_TYPES,
  ASSET_MAX_SIZE_BYTES,
  BRAND_SURFACES,
  BrandSurface,
} from '../../data-access/company-settings.model';
import { CompanySettingsStore } from '../../data-access/company-settings.store';

/**
 * Página del módulo Company Settings: identidad legal de la firma (Billing) + marca del tenant
 * (TenantBrands, superficie CRM): colores primary/accent, logo y favicon. Los pickers de color
 * aplican el tema EN VIVO (ThemeService) mientras se arrastran, y se persisten al guardar.
 */
@Component({
  selector: 'app-company-settings-page',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './company-settings-page.component.html',
})
export class CompanySettingsPageComponent {
  readonly store = inject(CompanySettingsStore);
  private readonly theme = inject(ThemeService);

  readonly assetMaxSizeKb = Math.round(ASSET_MAX_SIZE_BYTES / 1024);

  /** Superficies configurables (CRM / Portal del cliente) para el selector. */
  readonly surfaces = BRAND_SURFACES;

  /** Cambia la superficie de marca a editar (recarga su logo/favicon/colores). */
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

  // --- Formulario de colores (2 tokens tematizables) ---
  readonly primaryColor = signal('#1e466b');
  readonly accentColor = signal('#67baf4');

  /** Error de validación local del archivo (tipo/tamaño), previo a tocar el backend. */
  readonly assetFileError = signal<string | null>(null);

  readonly toast = signal<string | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

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

    // Paleta efectiva del backend (custom o default) → pickers.
    effect(() => {
      const c = this.store.colors();
      if (!c) {
        return;
      }
      this.primaryColor.set(c.primaryColor);
      this.accentColor.set(c.accentColor);
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

  // --- Colores ---

  /**
   * Preview en vivo mientras se arrastra el picker (aún no persiste). Solo se aplica al tema de esta
   * app cuando se edita la superficie CRM; editando el Portal, el picker muestra el color pero no
   * recolorea el CRM (esa marca es de otra superficie).
   */
  onPrimaryChange(hex: string): void {
    this.primaryColor.set(hex);
    if (this.store.surface() === 'Crm') {
      this.theme.setPrimaryColor(hex, { persist: false });
    }
  }

  onAccentChange(hex: string): void {
    this.accentColor.set(hex);
    if (this.store.surface() === 'Crm') {
      this.theme.setSecondaryColor(hex, { persist: false });
    }
  }

  get canSaveColors(): boolean {
    return !this.store.colorsSaving() && !this.store.colorsLoading() && this.store.colors() !== null;
  }

  saveColors(): void {
    if (!this.canSaveColors) {
      return;
    }
    this.store
      .saveColors({ primary: this.primaryColor(), accent: this.accentColor() })
      .subscribe({
        next: () => this.showToast('Brand colors saved'),
        error: () => {
          /* el mensaje ya quedó en store.colorsError */
        },
      });
  }

  resetColors(): void {
    if (!this.canSaveColors) {
      return;
    }
    this.store.resetColors().subscribe({
      next: () => this.showToast('Brand colors reset to default'),
      error: () => {
        /* el mensaje ya quedó en store.colorsError */
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
      next: () => this.showToast(key === 'logo' ? 'Logo uploaded' : 'Favicon uploaded'),
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

  private showToast(message: string): void {
    this.toast.set(message);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 2500);
  }
}
