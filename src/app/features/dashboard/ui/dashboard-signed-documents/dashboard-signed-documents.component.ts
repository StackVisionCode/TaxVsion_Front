import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toApiError } from '@core/models/api-error.model';
import { SignatureService } from '../../../signature/data-access/signature.service';
import {
  ApiSignatureRequestStatus,
  SignatureRequestSummary,
} from '../../../signature/data-access/signature.model';
import { DashboardWidgetStateComponent } from '../dashboard-widget-state/dashboard-widget-state.component';

/** Filas que muestra el widget. */
const MAX_ROWS = 5;

/** Pasteles que rotan en el círculo del icono (paleta azul de marca). */
const ICON_BACKGROUNDS = ['bg-indigo-50', 'bg-indigo-100', 'bg-gray-200'];

/**
 * Widget "Signed Documents".
 *
 * Antes listaba 5 PDFs inventados ("W9_Form-Maria-Gonzalez.pdf",
 * "2025_Tax_Return-John-Smith.pdf"…) con iniciales de firmantes y fechas
 * falsas.
 *
 * Ahora llama a `GET /signature/requests?page=1&size=5` vía `SignatureService`.
 * NO se usa `SignatureStore.refresh()` a propósito: ese método hace un GET de
 * detalle POR CADA fila (forkJoin N+1) para hidratar los firmantes, y un
 * widget del dashboard no debe pagar eso.
 *
 * Efecto honesto de esa decisión: el listado devuelve `signerCount`, no los
 * firmantes, así que en lugar de la pila de avatares (que antes eran
 * iniciales inventadas) se muestra el número real de firmantes. Los avatares
 * con nombre siguen estando en la página de Signature.
 */
@Component({
  selector: 'app-dashboard-signed-documents',
  imports: [CommonModule, RouterLink, DashboardWidgetStateComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-signed-documents.component.html',
})
export class DashboardSignedDocumentsComponent implements OnInit {
  private readonly service = inject(SignatureService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private readonly items = signal<SignatureRequestSummary[]>([]);

  /** Más recientes primero (por la fecha más significativa de cada solicitud). */
  readonly documents = computed<SignatureRequestSummary[]>(() =>
    [...this.items()].sort((a, b) => this.activityMs(b) - this.activityMs(a)),
  );

  ngOnInit(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list({ page: 1, size: MAX_ROWS }).subscribe({
      next: result => {
        this.items.set(result.items ?? []);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(toApiError(err).message);
        this.loading.set(false);
      },
    });
  }

  trackByDocumentId(_index: number, doc: SignatureRequestSummary): string {
    return doc.id;
  }

  iconBg(index: number): string {
    return ICON_BACKGROUNDS[index % ICON_BACKGROUNDS.length];
  }

  signersLabel(doc: SignatureRequestSummary): string {
    return `${doc.signerCount} signer${doc.signerCount === 1 ? '' : 's'}`;
  }

  /** Fecha más significativa: cuándo se completó, si no cuándo se envió, si no cuándo se creó. */
  dateLabel(doc: SignatureRequestSummary): string {
    const iso = doc.completedAtUtc ?? doc.sentAtUtc ?? doc.createdAtUtc;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** Estado tal cual lo reporta el backend, sin renombrarlo. */
  statusChipClass(status: ApiSignatureRequestStatus): string {
    switch (status) {
      case 'Completed':
        return 'border-emerald-200 text-emerald-600';
      case 'InProgress':
      case 'Ready':
        return 'border-orange-200 text-orange-500';
      case 'Rejected':
      case 'Canceled':
      case 'Expired':
        return 'border-red-200 text-red-500';
      case 'Draft':
        return 'border-gray-200 text-gray-500';
    }
  }

  /** "InProgress" → "In progress": la etiqueta del backend en formato legible. */
  statusLabel(status: ApiSignatureRequestStatus): string {
    return status === 'InProgress' ? 'In progress' : status;
  }

  private activityMs(doc: SignatureRequestSummary): number {
    const value = new Date(doc.completedAtUtc ?? doc.sentAtUtc ?? doc.createdAtUtc).getTime();
    return Number.isNaN(value) ? 0 : value;
  }
}
