import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, inject, input, signal } from '@angular/core';
import { SegmentedComponent } from '@shared/ui/segmented/segmented.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { AdminCapabilities } from '@core/access/admin-capabilities';
import {
  ASSET_ALLOWED_CONTENT_TYPES,
  ASSET_MAX_SIZE_BYTES,
  BRAND_SURFACES,
  BrandSurface,
} from '../../data-access/company-settings.model';
import { AssetKey, CompanyBrandStore } from '../../data-access/company-brand.store';
import { BrandAssetTileComponent } from '../../ui/brand-asset-tile/brand-asset-tile.component';
import { SectionHeaderComponent } from '../../ui/section-header/section-header.component';

/**
 * Logo y favicon por superficie (TenantBrands): el CRM lo ve el equipo, el portal los clientes. Se guarda
 * al subir (no pasa por la barra de guardado). Lo lee cualquiera; lo cambia `branding.manage`.
 */
@Component({
  selector: 'app-brand-section',
  imports: [SegmentedComponent, BrandAssetTileComponent, SectionHeaderComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './brand-section.component.html',
})
export class BrandSectionComponent {
  readonly store = inject(CompanyBrandStore);
  protected readonly can = inject(AdminCapabilities);
  private readonly toast = inject(ToastService);

  /** Nombre para la pestaña simulada del favicon. */
  readonly officeName = input('');

  readonly assetMaxSizeKb = Math.round(ASSET_MAX_SIZE_BYTES / 1024);
  readonly surfaces = BRAND_SURFACES.map(s => ({ id: s.value, label: s.label }));

  /** Error de validación local del archivo (tipo/tamaño), previo a tocar el backend. */
  readonly assetFileError = signal<string | null>(null);

  /** El logo vigente es SVG: se ve en la app pero el correo no lo renderiza. */
  readonly logoIsSvg = computed(() => this.store.logo()?.contentType === 'image/svg+xml');

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
}
