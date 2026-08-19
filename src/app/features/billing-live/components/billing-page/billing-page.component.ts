import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { switchMap } from 'rxjs';
import { BillingLiveService } from '../../data-access/billing-live.service';
import { Branding, InvoiceSummary, IssuerProfile, LineDraft, PaymentConfig } from '../../data-access/billing-live.model';

const EMPTY_ISSUER: IssuerProfile = {
  name: '',
  taxId: '',
  line1: '',
  city: '',
  state: '',
  zip: '',
  country: 'US',
  phone: '',
  email: '',
};

/**
 * Apartado "Facturación" en vivo (tenant): configurar el método de pago (Stripe) y crear/emitir
 * facturas, obtener su link de cobro y mandarlas a pagar. Cableado al backend real (Billing + PaymentClient).
 */
@Component({
  selector: 'app-billing-page',
  imports: [CommonModule, FormsModule],
  templateUrl: './billing-page.component.html',
  styleUrl: './billing-page.component.css',
})
export class BillingPageComponent implements OnInit {
  private readonly service = inject(BillingLiveService);

  readonly tab = signal<'methods' | 'invoices' | 'branding'>('methods');

  // --- Branding del template de facturas ---
  readonly brandColor = signal('#4f46e5');
  readonly brandDisplayName = signal('');
  readonly brandFooter = signal('');
  readonly brandLogo = signal<string | null>(null);
  readonly savingBranding = signal(false);
  readonly brandingMsg = signal<{ ok: boolean; text: string } | null>(null);

  // --- Métodos de pago ---
  readonly configs = signal<PaymentConfig[]>([]);
  readonly publishableKey = signal('');
  readonly secretKey = signal('');
  readonly webhookSecret = signal('');
  readonly statementDescriptor = signal('TAXVISION');
  readonly methodsMsg = signal<{ ok: boolean; text: string } | null>(null);
  readonly savingMethod = signal(false);

  // --- Emisor (empresa del tenant), recordado en localStorage ---
  readonly issuer = signal<IssuerProfile>({ ...EMPTY_ISSUER });
  readonly showIssuer = signal(false);

  // --- Facturas ---
  readonly invoices = signal<InvoiceSummary[]>([]);
  readonly customerName = signal('');
  readonly customerTaxId = signal('');
  readonly currency = signal('USD');
  readonly lines = signal<LineDraft[]>([{ description: '', quantity: 1, unitAmount: 0, taxPercent: 11.5 }]);
  readonly invoicesMsg = signal<{ ok: boolean; text: string } | null>(null);
  readonly creatingInvoice = signal(false);
  readonly busyInvoiceId = signal<string | null>(null);

  // --- Modales: pago manual + recibo + ver PDF ---
  readonly payModalInvoice = signal<InvoiceSummary | null>(null);
  readonly payMethod = signal('Cash');
  readonly savingManualPay = signal(false);
  readonly receiptInvoice = signal<InvoiceSummary | null>(null);
  readonly openingPdfId = signal<string | null>(null);
  readonly manualMethods = ['Cash', 'Check', 'BankTransfer', 'Other'];

  ngOnInit(): void {
    this.reloadConfigs();
    this.reloadInvoices();
    this.reloadBranding();
    this.service.getIssuerProfile().subscribe({
      next: p =>
        this.issuer.set({
          name: p.name || '',
          taxId: p.taxId || '',
          line1: p.line1 || '',
          city: p.city || '',
          state: p.state || '',
          zip: p.zip || '',
          country: p.country || 'US',
          phone: p.phone || '',
          email: p.email || '',
        }),
      error: () => {
        /* sin perfil aún: queda vacío */
      },
    });
  }

  // ---------------- Branding ----------------
  reloadBranding(): void {
    this.service.getBranding().subscribe({
      next: (b: Branding) => {
        this.brandColor.set(b.brandColorHex || '#4f46e5');
        this.brandDisplayName.set(b.displayName || '');
        this.brandFooter.set(b.footerText || '');
        this.brandLogo.set(b.logoDataUri || null);
      },
      error: () => {
        /* sin branding aún */
      },
    });
  }

  onLogoSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.brandingMsg.set({ ok: false, text: 'El logo debe ser una imagen.' });
      return;
    }
    if (file.size > 200 * 1024) {
      this.brandingMsg.set({ ok: false, text: 'El logo es muy grande (máx. 200 KB). Usá una imagen más liviana.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.brandLogo.set(reader.result as string);
    reader.readAsDataURL(file);
  }

  clearLogo(): void {
    this.brandLogo.set(null);
  }

  saveBranding(): void {
    this.savingBranding.set(true);
    this.brandingMsg.set(null);
    this.service
      .saveBranding({
        displayName: this.brandDisplayName(),
        logoDataUri: this.brandLogo(),
        brandColorHex: this.brandColor(),
        footerText: this.brandFooter(),
      })
      .subscribe({
        next: () => {
          this.savingBranding.set(false);
          this.brandingMsg.set({ ok: true, text: 'Branding guardado. Se aplicará al PDF de las próximas facturas.' });
        },
        error: err => {
          this.savingBranding.set(false);
          this.brandingMsg.set({ ok: false, text: err?.error?.message ?? 'No se pudo guardar el branding.' });
        },
      });
  }

  updateIssuer(patch: Partial<IssuerProfile>): void {
    this.issuer.update(i => ({ ...i, ...patch }));
  }

  saveIssuer(): void {
    if (!this.issuer().name.trim()) {
      this.invoicesMsg.set({ ok: false, text: 'El nombre de la empresa es requerido.' });
      return;
    }
    this.service.saveIssuerProfile(this.issuer()).subscribe({
      next: () => this.invoicesMsg.set({ ok: true, text: 'Datos de la empresa guardados. Aparecerán en las próximas facturas.' }),
      error: err => this.invoicesMsg.set({ ok: false, text: err?.error?.message ?? 'No se pudo guardar.' }),
    });
  }

  // ---------------- Métodos de pago ----------------
  reloadConfigs(): void {
    this.service.listConfigs().subscribe({
      next: c => this.configs.set(c),
      error: () => this.configs.set([]),
    });
  }

  saveStripe(): void {
    if (!this.publishableKey() || !this.secretKey()) {
      this.methodsMsg.set({ ok: false, text: 'Publishable key y secret key son requeridos.' });
      return;
    }
    this.savingMethod.set(true);
    this.methodsMsg.set(null);
    this.service
      .createConfig({
        providerCode: 'Stripe',
        mode: 'DirectApiKeys',
        publishableKey: this.publishableKey(),
        statementDescriptor: this.statementDescriptor() || 'TAXVISION',
      })
      .pipe(
        switchMap(() =>
          this.service.setSecrets('Stripe', {
            secretKey: this.secretKey(),
            webhookSecret: this.webhookSecret() || 'whsec_placeholder',
          })
        ),
        switchMap(() => this.service.activate('Stripe'))
      )
      .subscribe({
        next: () => {
          this.savingMethod.set(false);
          this.methodsMsg.set({ ok: true, text: 'Stripe configurado y activado.' });
          this.secretKey.set('');
          this.webhookSecret.set('');
          this.reloadConfigs();
        },
        error: err => {
          this.savingMethod.set(false);
          this.methodsMsg.set({ ok: false, text: err?.error?.message ?? 'No se pudo configurar (¿permiso o key inválida?).' });
        },
      });
  }

  toggleActive(config: PaymentConfig): void {
    const op = config.isActive
      ? this.service.deactivate(config.providerCode, 'Desactivado desde settings')
      : this.service.activate(config.providerCode);
    op.subscribe({ next: () => this.reloadConfigs(), error: () => this.reloadConfigs() });
  }

  // ---------------- Facturas ----------------
  reloadInvoices(): void {
    this.service.listInvoices().subscribe({
      next: i => this.invoices.set(i),
      error: () => this.invoices.set([]),
    });
  }

  addLine(): void {
    this.lines.update(l => [...l, { description: '', quantity: 1, unitAmount: 0, taxPercent: 11.5 }]);
  }
  removeLine(i: number): void {
    this.lines.update(l => l.filter((_, idx) => idx !== i));
  }
  updateLine(i: number, patch: Partial<LineDraft>): void {
    this.lines.update(l => l.map((line, idx) => (idx === i ? { ...line, ...patch } : line)));
  }

  createInvoice(): void {
    if (!this.customerName() || this.lines().some(l => !l.description || l.unitAmount <= 0)) {
      this.invoicesMsg.set({ ok: false, text: 'Cliente y líneas (descripción + monto) son requeridos.' });
      return;
    }
    this.creatingInvoice.set(true);
    this.invoicesMsg.set(null);
    // El emisor lo estampa Billing desde el perfil guardado — no se manda acá.
    this.service
      .createInvoice(this.customerName(), this.customerTaxId(), this.currency(), this.lines())
      .subscribe({
      next: () => {
        this.creatingInvoice.set(false);
        this.invoicesMsg.set({ ok: true, text: 'Borrador de factura creado.' });
        this.customerName.set('');
        this.lines.set([{ description: '', quantity: 1, unitAmount: 0, taxPercent: 11.5 }]);
        this.reloadInvoices();
      },
      error: err => {
        this.creatingInvoice.set(false);
        this.invoicesMsg.set({ ok: false, text: err?.error?.message ?? 'No se pudo crear la factura.' });
      },
    });
  }

  issue(inv: InvoiceSummary): void {
    this.busyInvoiceId.set(inv.id);
    this.service.issueInvoice(inv.id).subscribe({
      next: () => this.pollForLink(inv.id, 0),
      error: () => {
        this.busyInvoiceId.set(null);
        this.invoicesMsg.set({ ok: false, text: 'No se pudo emitir.' });
      },
    });
  }

  /** El link de cobro lo asegura Billing async tras emitir; poll hasta que aparezca CheckoutUrl. */
  private pollForLink(id: string, attempt: number): void {
    this.service.getInvoice(id).subscribe({
      next: updated => {
        this.patchInvoice(updated);
        if (updated.checkoutUrl || attempt >= 8) {
          this.busyInvoiceId.set(null);
        } else {
          setTimeout(() => this.pollForLink(id, attempt + 1), 1500);
        }
      },
      error: () => this.busyInvoiceId.set(null),
    });
  }

  private patchInvoice(updated: InvoiceSummary): void {
    this.invoices.update(list => list.map(i => (i.id === updated.id ? updated : i)));
  }

  refreshInvoice(inv: InvoiceSummary): void {
    this.service.getInvoice(inv.id).subscribe({ next: u => this.patchInvoice(u) });
  }

  copyLink(url: string): void {
    navigator.clipboard?.writeText(url);
    this.invoicesMsg.set({ ok: true, text: 'Link copiado al portapapeles.' });
  }

  // --- Pago manual ---
  openManualPay(inv: InvoiceSummary): void {
    this.payMethod.set('Cash');
    this.payModalInvoice.set(inv);
  }
  closePayModal(): void {
    this.payModalInvoice.set(null);
  }
  confirmManualPay(): void {
    const inv = this.payModalInvoice();
    if (!inv) return;
    this.savingManualPay.set(true);
    this.service.recordManualPayment(inv.id, this.payMethod(), inv.totalCents).subscribe({
      next: () => {
        this.savingManualPay.set(false);
        this.payModalInvoice.set(null);
        this.invoicesMsg.set({ ok: true, text: 'Pago manual registrado. Factura pagada.' });
        this.reloadInvoices();
      },
      error: err => {
        this.savingManualPay.set(false);
        this.invoicesMsg.set({ ok: false, text: err?.error?.message ?? 'No se pudo registrar el pago.' });
      },
    });
  }

  // --- Recibo ---
  openReceipt(inv: InvoiceSummary): void {
    this.receiptInvoice.set(inv);
  }
  closeReceipt(): void {
    this.receiptInvoice.set(null);
  }

  // --- Ver el PDF de la factura ---
  viewPdf(inv: InvoiceSummary): void {
    if (!inv.pdfFileId) {
      this.invoicesMsg.set({ ok: false, text: 'El PDF todavía no está listo. Probá "Refrescar" en unos segundos.' });
      return;
    }
    this.openingPdfId.set(inv.id);
    this.service.getDownloadUrl(inv.pdfFileId).subscribe({
      next: res => {
        this.openingPdfId.set(null);
        window.open(res.downloadUrl, '_blank', 'noopener');
      },
      error: () => {
        this.openingPdfId.set(null);
        this.invoicesMsg.set({ ok: false, text: 'No se pudo abrir el PDF (¿permiso de descarga?).' });
      },
    });
  }

  money(cents: number, currency: string): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  }

  /** Muestra el hash acortado (fingerprint) — el completo queda en el botón Copiar. */
  shortHash(h?: string | null): string {
    return h ? h.slice(0, 24) + '…' : '';
  }

  statusLabel(status: string): string {
    return (
      {
        Draft: 'Borrador',
        Issued: 'Pendiente de pago',
        Sent: 'Enviada',
        PartiallyPaid: 'Pago parcial',
        Paid: 'Pagada',
        Voided: 'Anulada',
      }[status] ?? status
    );
  }
}
