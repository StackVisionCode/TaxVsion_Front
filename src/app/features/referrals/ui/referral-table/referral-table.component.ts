import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ReferralStatus = 'pending' | 'completed' | 'rewarded';

export interface Referral {
  id: string;
  name: string;
  /** Iniciales mostradas dentro del avatar circular (ej. "MG"). */
  initials: string;
  /** Clase Tailwind de color de fondo del avatar (ej. "bg-[#7C6AE0]"). */
  avatarColor: string;
  email: string;
  /** Fecha ya formateada para mostrar (ej. "Jun 22, 2026"). */
  date: string;
  status: ReferralStatus;
  /** Recompensa en USD; 0 cuando el referido aún está pendiente. */
  amount: number;
}

/**
 * Tabla de referidos (patrón "Aether", igual que service-catalog / invoice-table):
 * header en píldora `bg-[#FAF9F7]` con extremos redondeados y columnas
 * Name (avatar + iniciales) / Email / Date / Status (chip outline) / Reward.
 * Componente puramente presentacional: recibe la lista ya filtrada por input.
 */
@Component({
  selector: 'app-referral-table',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './referral-table.component.html',
})
export class ReferralTableComponent {
  @Input() referrals: Referral[] = [];

  trackByReferralId(_index: number, referral: Referral): string {
    return referral.id;
  }

  formatCurrency(amount: number): string {
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
  }

  statusLabel(status: ReferralStatus): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'completed':
        return 'Completed';
      case 'rewarded':
        return 'Rewarded';
    }
  }

  statusChip(status: ReferralStatus): string {
    switch (status) {
      case 'completed':
        return 'border-emerald-200 text-emerald-600';
      case 'rewarded':
        return 'border-emerald-200 text-emerald-600';
      case 'pending':
        return 'border-orange-200 text-orange-500';
    }
  }

  statusDot(status: ReferralStatus): string {
    switch (status) {
      case 'completed':
        return 'bg-emerald-500';
      case 'rewarded':
        return 'bg-emerald-500';
      case 'pending':
        return 'bg-orange-500';
    }
  }
}
