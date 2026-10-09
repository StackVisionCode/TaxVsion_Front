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
      <span class="platform-logo-fallback" [class]="fallbackClass()">
        <img src="/favicon.svg" alt="" aria-hidden="true" />
        <strong>TaxProffice</strong>
      </span>
    </ng-template>
  `,
  styles: `
    .platform-logo-fallback {
      display: inline-flex;
      min-width: 0;
      align-items: center;
      gap: 0.55rem;
      color: #082f49;
    }

    .platform-logo-fallback img {
      width: 2rem;
      height: 2rem;
      flex: 0 0 auto;
    }

    .platform-logo-fallback strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 1.08rem;
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
