import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BillingStore } from '../../data-access/billing.store';
import { CompanyBrandingFormComponent } from '../../ui/company-branding-form/company-branding-form.component';
import { InvoiceBranding, IssuerProfile } from '../../data-access/billing.model';

/**
 * Datos de la empresa (emisor) + branding del PDF de facturas. Vive bajo /billing/company pero se
 * accede desde Settings. Reusa <app-company-branding-form> y el BillingStore.
 */
@Component({
  selector: 'app-company-billing-page',
  imports: [CommonModule, CompanyBrandingFormComponent],
  template: `
    <div class="min-h-full pt-3 pb-1">
      <app-company-branding-form
        [issuer]="store.issuer()"
        [branding]="store.branding()"
        [saving]="store.savingCompany()"
        (saveRequested)="onSave($event)"
      ></app-company-branding-form>
    </div>
  `,
})
export class CompanyBillingPageComponent implements OnInit {
  readonly store = inject(BillingStore);

  ngOnInit(): void {
    this.store.loadCompany();
  }

  onSave(event: { issuer: IssuerProfile; branding: InvoiceBranding }): void {
    this.store.saveCompany(event.issuer, event.branding);
  }
}
