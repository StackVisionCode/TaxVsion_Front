import { InvoiceSettings, PAYMENT_TERMS } from '../data-access/company-settings.model';
import { InvoiceField } from './office-profile-rules';

/** Largo máximo de instrucciones y pie (columnas de 500 en Billing). */
export const INVOICE_TEXT_MAX = 500;

/** Texto vacío viaja como null (Billing lo guarda así). */
export function normalizeInvoiceSettings(form: InvoiceSettings): InvoiceSettings {
  return {
    paymentTerms: form.paymentTerms || 'DueOnReceipt',
    paymentInstructions: form.paymentInstructions?.trim() || null,
    invoiceFooter: form.invoiceFooter?.trim() || null,
  };
}

export function invoiceErrors(form: InvoiceSettings): Partial<Record<InvoiceField, string>> {
  const errors: Partial<Record<InvoiceField, string>> = {};
  if ((form.paymentInstructions?.trim().length ?? 0) > INVOICE_TEXT_MAX) {
    errors.paymentInstructions = `Payment instructions cannot exceed ${INVOICE_TEXT_MAX} characters.`;
  }
  if ((form.invoiceFooter?.trim().length ?? 0) > INVOICE_TEXT_MAX) {
    errors.invoiceFooter = `The invoice footer cannot exceed ${INVOICE_TEXT_MAX} characters.`;
  }
  return errors;
}

export function invoiceSettingsChanged(form: InvoiceSettings, loaded: InvoiceSettings): boolean {
  return JSON.stringify(normalizeInvoiceSettings(form)) !== JSON.stringify(normalizeInvoiceSettings(loaded));
}

/** "Net30" → "Net 30" (lo que imprime la factura). */
export function paymentTermsLabel(value: string | null | undefined): string {
  return PAYMENT_TERMS.find(t => t.value === value)?.label ?? 'Due on receipt';
}
