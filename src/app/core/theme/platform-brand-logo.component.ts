import { NgIf } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { TenantBrandingService } from './tenant-branding.service';

/** Logo principal de TaxProffice para superficies que tambien muestran la marca de una oficina. */
@Component({
  selector: 'app-platform-brand-logo',
  standalone: true,
  imports: [NgIf],
  template: `
    <img
      *ngIf="branding.systemLogoUrl() && !failed(); else fallback"
      [src]="branding.systemLogoUrl()"
      alt="TaxProffice"
      [class]="logoClass()"
      (error)="failed.set(true)"
    />
    <ng-template #fallback>
      <strong class="platform-logo-fallback" [class]="fallbackClass()">TAXPROFFICE</strong>
    </ng-template>
  `,
  styles: `
    .platform-logo-fallback {
      display: inline-block;
      min-width: 0;
      color: #082f49;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 1rem;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0;
    }
  `,
})
export class PlatformBrandLogoComponent {
  readonly branding = inject(TenantBrandingService);
  readonly failed = signal(false);

  readonly logoClass = input('h-9 max-w-[170px] object-contain');
  readonly fallbackClass = input('');

  constructor() {
    this.branding.loadSystemBrandLogo('Crm');
  }
}
