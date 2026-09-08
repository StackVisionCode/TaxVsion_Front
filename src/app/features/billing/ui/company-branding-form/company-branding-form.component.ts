import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InvoiceBranding, IssuerProfile } from '../../data-access/billing.model';

/** El logo viaja embebido como data URI dentro del JSON del branding. */
const MAX_LOGO_BYTES = 200 * 1024;

/**
 * Datos de la firma que se estampan en la factura: el emisor (`/billing/issuer-profile`) y la marca
 * del PDF (`/documents/branding`). Son dos endpoints de dos servicios distintos, pero alimentan el
 * mismo documento, así que se editan juntos y se guardan en cadena.
 *
 * Guardar el emisor **una vez** es el paso que espera Billing: al crear una factura se manda
 * `issuer: null` y el backend estampa este perfil (`IsUsable` = tiene nombre). Si no está, la
 * factura sale sin los datos de la firma.
 *
 * El CRM legado tenía además un selector de cuatro plantillas (Classic/Modern/Minimal/Professional).
 * No existe acá: el contrato de branding solo admite nombre, logo, color y pie.
 */
@Component({
  selector: 'app-company-branding-form',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './company-branding-form.component.html',
})
export class CompanyBrandingFormComponent implements OnChanges {
  @Input({ required: true }) issuer!: IssuerProfile;
  @Input({ required: true }) branding!: InvoiceBranding;
  @Input() saving = false;

  @Output() saveRequested = new EventEmitter<{ issuer: IssuerProfile; branding: InvoiceBranding }>();

  /** Copias editables: el store es la fuente de verdad y solo se pisa al guardar. */
  readonly draftIssuer = signal<IssuerProfile | null>(null);
  readonly draftBranding = signal<InvoiceBranding | null>(null);
  readonly logoError = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['issuer'] && this.issuer) {
      this.draftIssuer.set({ ...this.issuer });
    }
    if (changes['branding'] && this.branding) {
      this.draftBranding.set({ ...this.branding });
    }
  }

  updateIssuer(patch: Partial<IssuerProfile>): void {
    this.draftIssuer.update(current => (current ? { ...current, ...patch } : current));
  }

  updateBranding(patch: Partial<InvoiceBranding>): void {
    this.draftBranding.update(current => (current ? { ...current, ...patch } : current));
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.logoError.set('The logo must be an image.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      this.logoError.set('The logo is too large (200 KB max). Use a lighter image.');
      return;
    }
    this.logoError.set(null);
    const reader = new FileReader();
    reader.onload = () => this.updateBranding({ logoDataUri: String(reader.result ?? '') });
    reader.onerror = () => this.logoError.set("We couldn't read that image.");
    reader.readAsDataURL(file);
  }

  clearLogo(): void {
    this.updateBranding({ logoDataUri: null });
    this.logoError.set(null);
  }

  get canSave(): boolean {
    return !this.saving && (this.draftIssuer()?.name ?? '').trim().length > 0;
  }

  save(): void {
    const issuer = this.draftIssuer();
    const branding = this.draftBranding();
    if (!this.canSave || !issuer || !branding) {
      return;
    }
    this.saveRequested.emit({ issuer, branding });
  }
}
