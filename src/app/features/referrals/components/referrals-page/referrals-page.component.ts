import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Referral, ReferralStatus, ReferralTableComponent } from '../../ui/referral-table/referral-table.component';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';

type StatusFilter = 'All' | ReferralStatus;
const PAGE_SIZE = 8;

const SEED_REFERRALS: Referral[] = [
  { id: 'ref-1', name: 'Maria Garcia', initials: 'MG', avatarColor: 'bg-[#7C6AE0]', email: 'maria.garcia@email.com', date: 'Jun 22, 2026', status: 'rewarded', amount: 100 },
  { id: 'ref-2', name: 'Carlos Lopez', initials: 'CL', avatarColor: 'bg-[#A99BEB]', email: 'carlos.lopez@email.com', date: 'Jun 21, 2026', status: 'completed', amount: 50 },
  { id: 'ref-3', name: 'Ana Martinez', initials: 'AM', avatarColor: 'bg-[#E0A16A]', email: 'ana.martinez@email.com', date: 'Jun 20, 2026', status: 'pending', amount: 0 },
  { id: 'ref-4', name: 'Pedro Sanchez', initials: 'PS', avatarColor: 'bg-[#6AA7E0]', email: 'pedro.sanchez@email.com', date: 'Jun 19, 2026', status: 'rewarded', amount: 100 },
  { id: 'ref-5', name: 'Laura Rodriguez', initials: 'LR', avatarColor: 'bg-[#E06A9A]', email: 'laura.rodriguez@email.com', date: 'Jun 18, 2026', status: 'pending', amount: 0 },
  { id: 'ref-6', name: 'Miguel Hernandez', initials: 'MH', avatarColor: 'bg-[#5FBFA3]', email: 'miguel.hernandez@email.com', date: 'Jun 17, 2026', status: 'completed', amount: 50 },
  { id: 'ref-7', name: 'Sofia Torres', initials: 'ST', avatarColor: 'bg-[#7C6AE0]', email: 'sofia.torres@email.com', date: 'Jun 16, 2026', status: 'rewarded', amount: 100 },
  { id: 'ref-8', name: 'Diego Ramirez', initials: 'DR', avatarColor: 'bg-[#C08A5F]', email: 'diego.ramirez@email.com', date: 'Jun 15, 2026', status: 'completed', amount: 50 },
  { id: 'ref-9', name: 'Valentina Cruz', initials: 'VC', avatarColor: 'bg-[#A99BEB]', email: 'valentina.cruz@email.com', date: 'Jun 14, 2026', status: 'pending', amount: 0 },
];

/**
 * Página del módulo Referrals (estilo "Aether"): hero de balance con el total
 * ganado + 3 stat cards pastel (referidos totales, pendientes, completados),
 * una tarjeta con el código de referido (píldora + botón negro "Copy link"
 * con toast transitorio "Copied!") y una tabla de referidos con búsqueda y
 * filtros por estado. Todo el estado vive en signals dentro de esta página,
 * sin servicios ni backend; los datos son un mock estático.
 */
@Component({
  selector: 'app-referrals-page',
  imports: [CommonModule, FormsModule, ReferralTableComponent, PaginationComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './referrals-page.component.html',
})
export class ReferralsPageComponent {
  readonly referrals = signal<Referral[]>(SEED_REFERRALS);
  readonly search = signal('');

  readonly statusFilters: StatusFilter[] = ['All', 'pending', 'completed', 'rewarded'];
  readonly statusFilter = signal<StatusFilter>('All');

  /** Código de referido estático mostrado en la píldora de la tarjeta. */
  readonly referralCode = 'TAXVISION-JR2026';

  /** Toast transitorio: true durante 2s tras copiar el enlace de referido. */
  readonly copied = signal(false);

  readonly totalReferrals = computed(() => this.referrals().length);

  readonly pendingCount = computed(() => this.referrals().filter(r => r.status === 'pending').length);

  readonly completedCount = computed(
    () => this.referrals().filter(r => r.status === 'completed' || r.status === 'rewarded').length,
  );

  readonly totalEarned = computed(() => this.referrals().reduce((sum, r) => sum + r.amount, 0));

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

  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly pagedReferrals = computed<Referral[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.visibleReferrals().slice(start, start + PAGE_SIZE);
  });

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

  formatCurrency(amount: number): string {
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
  }

  /** Simula copiar el enlace de referido y muestra el toast "Copied!" durante 2 segundos. */
  copyLink(): void {
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }
}
