import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '@core/config/api-config.service';

/**
 * Lecturas de RESUMEN por cliente para el Overview del perfil, contra los mismos endpoints que usan
 * Billing, Signature, SMS y Meetings. Se piden desde la feature clients (en vez de inyectar los
 * servicios de esas features) para respetar "una feature no importa de otra": los tipos de abajo
 * son solo los campos que el Overview pinta, no el contrato completo de cada módulo.
 */

export type SummaryInvoiceStatus = 'Draft' | 'Issued' | 'Sent' | 'PartiallyPaid' | 'Paid' | 'Voided';

/** GET /billing/invoices?customerId= (subset de InvoiceSummary). */
export interface SummaryInvoice {
  id: string;
  invoiceNumber?: string | null;
  status: SummaryInvoiceStatus;
  currency: string;
  totalCents: number;
  amountDueCents: number;
  amountPaidCents: number;
  createdAtUtc: string;
  paidAtUtc?: string | null;
}

export type SummarySignatureStatus =
  | 'Draft'
  | 'Ready'
  | 'Scheduled'
  | 'InProgress'
  | 'Completed'
  | 'Rejected'
  | 'Canceled'
  | 'Expired';

/** GET /signature/requests?customerId= (subset de SignatureRequestSummary). */
export interface SummarySignatureRequest {
  id: string;
  title: string;
  status: SummarySignatureStatus;
  signerCount: number;
  expiresAtUtc: string | null;
  createdAtUtc: string;
  sentAtUtc: string | null;
  completedAtUtc: string | null;
}

export interface SummarySignaturePage {
  items: SummarySignatureRequest[];
  totalCount: number;
}

export type SummarySmsStatus = 'Pending' | 'Accepted' | 'Delivered' | 'Failed' | 'Undeliverable' | 'Suppressed';

/** GET /sms/messages?customerId= (subset de SmsMessageSummary; todos son salientes). */
export interface SummarySmsMessage {
  id: string;
  body: string;
  status: SummarySmsStatus;
  createdAtUtc: string;
}

export interface SummarySmsPage {
  items: SummarySmsMessage[];
  totalCount: number;
}

export type SummaryMeetingStatus = 'Scheduled' | 'Live' | 'Ended' | 'Cancelled';

/** GET /communication/meetings?scope=upcoming&customerId= (vía el usuario de portal del cliente). */
export interface SummaryMeeting {
  id: string;
  title: string;
  status: SummaryMeetingStatus;
  scheduledForUtc: string | null;
  startedAtUtc: string | null;
}

export interface SummaryMeetingPage {
  items: SummaryMeeting[];
  totalCount: number;
}

@Injectable({ providedIn: 'root' })
export class ClientSummaryService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  invoices(customerId: string, take = 100): Observable<SummaryInvoice[]> {
    const params = new HttpParams().set('take', take).set('customerId', customerId);
    return this.http.get<SummaryInvoice[]>(this.api.tenantUrl('/billing/invoices'), { params });
  }

  signatures(customerId: string, size = 50): Observable<SummarySignaturePage> {
    const params = new HttpParams().set('customerId', customerId).set('page', 1).set('size', size);
    return this.http.get<SummarySignaturePage>(this.api.tenantUrl('/signature/requests'), { params });
  }

  sms(customerId: string, size = 5): Observable<SummarySmsPage> {
    const params = new HttpParams().set('customerId', customerId).set('page', 1).set('size', size);
    return this.http.get<SummarySmsPage>(this.api.tenantUrl('/sms/messages'), { params });
  }

  upcomingMeetings(customerId: string, size = 3): Observable<SummaryMeetingPage> {
    const params = new HttpParams().set('scope', 'upcoming').set('customerId', customerId).set('page', 1).set('size', size);
    return this.http.get<SummaryMeetingPage>(this.api.tenantUrl('/communication/meetings'), { params });
  }
}
