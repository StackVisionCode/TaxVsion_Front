import { Component, CUSTOM_ELEMENTS_SCHEMA, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LOGO_ALLOWED_CONTENT_TYPES,
  LOGO_MAX_SIZE_BYTES,
} from '../../data-access/company-settings.model';
import { CompanySettingsStore } from '../../data-access/company-settings.store';

/**
 * Página del módulo Company Settings (estilo "Aether"): identidad legal de la firma
 * persistida en Billing (GET/PUT /billing/issuer-profile — nombre, EIN→taxId, dirección,
 * contacto) más el branding del tenant (logo y paleta de colores vía /tenants/{id}/...).
 * Los campos que el backend no almacena (brand, business structure, descripción) se
 * quitaron del formulario para no simular persistencia.
 */
@Component({
  selector: 'app-company-settings-page',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './company-settings-page.component.html',
})
export class CompanySettingsPageComponent {
  readonly store = inject(CompanySettingsStore);

  readonly logoMaxSizeKb = Math.round(LOGO_MAX_SIZE_BYTES / 1024);

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

  // --- Formulario de colores (espejo editable de store.colors) ---
  readonly primaryColor = signal('#111827');
  readonly accentColor = signal('#4f46e5');
  readonly backgroundColor = signal('#ffffff');
  readonly textColor = signal('#111827');

  /** Error de validación local del archivo de logo (tipo/tamaño), previo a tocar el backend. */
  readonly logoFileError = signal<string | null>(null);

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
      this.backgroundColor.set(c.backgroundColor);
      this.textColor.set(c.textColor);
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

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite reseleccionar el mismo archivo
    if (!file) {
      return;
    }
    this.logoFileError.set(null);
    if (!LOGO_ALLOWED_CONTENT_TYPES.includes(file.type)) {
      this.logoFileError.set('Logo must be a PNG, JPEG or SVG image.');
      return;
    }
    if (file.size > LOGO_MAX_SIZE_BYTES) {
      this.logoFileError.set(`Logo must be at most ${this.logoMaxSizeKb} KB.`);
      return;
    }
    this.store.uploadLogo(file).subscribe({
      next: () => this.showToast('Logo uploaded'),
      error: () => {
        /* el mensaje ya quedó en store.logoError */
      },
    });
  }

  removeLogo(): void {
    if (this.store.logoBusy() || !this.store.logo()) {
      return;
    }
    this.logoFileError.set(null);
    this.store.removeLogo().subscribe({
      next: () => this.showToast('Logo removed'),
      error: () => {
        /* el mensaje ya quedó en store.logoError */
      },
    });
  }

  get canSaveColors(): boolean {
    return !this.store.colorsSaving() && !this.store.colorsLoading() && this.store.colors() !== null;
  }

  saveColors(): void {
    if (!this.canSaveColors) {
      return;
    }
    this.store
      .saveColors({
        primaryColor: this.primaryColor(),
        accentColor: this.accentColor(),
        backgroundColor: this.backgroundColor(),
        textColor: this.textColor(),
      })
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

  private showToast(message: string): void {
    this.toast.set(message);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 2500);
  }
}
