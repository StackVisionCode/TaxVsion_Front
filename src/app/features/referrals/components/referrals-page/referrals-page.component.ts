import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Referral, ReferralStatus, ReferralTableComponent } from '../../ui/referral-table/referral-table.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { ReferralsStore } from '../../data-access/referrals.store';

type StatusFilter = 'All' | ReferralStatus;
const PAGE_SIZE = 8;

/**
 * Página del módulo Referrals (estilo "Aether"): hero de balance + 3 stat cards pastel,
 * tarjeta con el código de referido real (POST /growth/referrals/codes, get-or-create
 * idempotente vía ReferralsStore) con copy/share del enlace `/register?referral=<code>`,
 * y la tabla de referidos.
 *
 * Los montos y la lista de referidos NO tienen fuente de datos: Growth no expone ningún
 * GET de atribuciones/earnings del tenant (gap del backend), así que el hero y las stat
 * cards muestran "—" y la tabla un estado vacío honesto en lugar de datos inventados.
 */
@Component({
  selector: 'app-referrals-page',
  imports: [CommonModule, FormsModule, ReferralTableComponent, PaginationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './referrals-page.component.html',
})
export class ReferralsPageComponent implements OnInit {
  private readonly store = inject(ReferralsStore);

  /** Vacío hasta que el backend exponga un listado (ver ReferralsStore.referrals). */
  readonly referrals = this.store.referrals;
  readonly codeLoading = this.store.loading;
  readonly codeError = this.store.error;
  readonly referralCode = this.store.referralCode;
  readonly referralLink = this.store.referralLink;

  readonly search = signal('');

  readonly statusFilters: StatusFilter[] = ['All', 'pending', 'completed', 'rewarded'];
  readonly statusFilter = signal<StatusFilter>('All');

  /** Toast transitorio: true durante 2s tras copiar el enlace de referido. */
  readonly copied = signal(false);

  readonly visibleReferrals = computed<Referral[]>(() => {
    const query = this.search().trim().toLowerCase();
    const filter = this.statusFilter();
    return this.referrals()
      .filter(referral => filter === 'All' || referral.status === filter)
      .filter(
        referral =>
          !query ||
          referral.name.toLowerCase().includes(query) ||
          referral.email.toLowerCase().includes(query),
      );
  });

  /** true cuando el vacío viene de filtros/búsqueda y no de la falta de datos del backend. */
  readonly hasAnyReferral = computed(() => this.referrals().length > 0);

  readonly emptyMessage = computed(() =>
    this.hasAnyReferral()
      ? 'No referrals match your search'
      : 'Share your referral link — people who join with it will appear here',
  );

  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly pagedReferrals = computed<Referral[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleReferrals().slice(start, start + PAGE_SIZE);
  });

  ngOnInit(): void {
    this.store.loadCode();
  }

  retryLoadCode(): void {
    this.store.loadCode(true);
  }

  filterLabel(filter: StatusFilter): string {
    return filter === 'All' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1);
  }

  setFilter(filter: StatusFilter): void {
    this.statusFilter.set(filter);
    this.currentPage.set(1);
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    this.currentPage.set(1);
  }

  /** Copia el enlace real de referido y muestra el toast "Copied!" durante 2 segundos. */
  copyLink(): void {
    const link = this.referralLink();
    if (!link) {
      return;
    }
    // navigator.clipboard es undefined fuera de contextos seguros (http plano).
    const write = navigator.clipboard?.writeText(link) ?? Promise.reject(new Error('Clipboard API unavailable'));
    write
      .catch(() => copyWithTextarea(link))
      .finally(() => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2000);
      });
  }

  shareOnX(): void {
    const code = this.referralCode();
    const link = this.referralLink();
    if (!code || !link) {
      return;
    }
    const text = encodeURIComponent(`Join TaxPro Office using my referral code ${code} and we both get rewarded!`);
    const url = encodeURIComponent(link);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'noopener,noreferrer');
  }

  shareByEmail(): void {
    const code = this.referralCode();
    const link = this.referralLink();
    if (!code || !link) {
      return;
    }
    const subject = encodeURIComponent('Join me on TaxPro Office');
    const body = encodeURIComponent(
      `Use my referral code ${code} when you sign up for TaxPro Office and we both get rewarded!\n\n${link}`,
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }
}

/** Fallback de copiado para contextos sin Clipboard API (http plano / navegadores viejos). */
function copyWithTextarea(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}
