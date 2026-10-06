import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { StatusPillComponent, StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { MoneyPipe } from '@shared/pipes/money.pipe';

export type ReferralStatus = 'pending' | 'completed' | 'rewarded';

export interface Referral {
  id: string;
  name: string;
  /** Clase Tailwind de color de fondo del avatar (ej. "bg-brand-bold"). */
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
 * header en píldora `bg-brand-white` con extremos redondeados y columnas
 * Name (avatar + iniciales) / Email / Date / Status (chip outline) / Reward.
 * Componente puramente presentacional: recibe la lista ya filtrada por input.
 */
@Component({
  selector: 'app-referral-table',
  imports: [CommonModule, AvatarComponent, StatusPillComponent, StateBlockComponent, MoneyPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './referral-table.component.html',
})
export class ReferralTableComponent {
  @Input() referrals: Referral[] = [];

  /** Mensaje del estado vacío (la página lo cambia según haya filtros o no exista data del backend). */
  @Input() emptyMessage = 'No referrals match your search';

  trackByReferralId(_index: number, referral: Referral): string {
    return referral.id;
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

  statusTone(status: ReferralStatus): StatusTone {
    return status === 'pending' ? 'warning' : 'success';
  }
}
