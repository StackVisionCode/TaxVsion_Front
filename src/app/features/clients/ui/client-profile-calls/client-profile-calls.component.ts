import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CallsService } from '@core/communication/calls.service';
import { ActiveCallService } from '@core/communication/active-call.service';
import { CallKind, CustomerCallItem, CustomerCallsStats } from '@core/communication/call.model';

/**
 * Pestaña "Calls" del perfil de cliente. El historial in-app se atribuye al cliente por su UserId de
 * PORTAL (puente `CustomerPortalAccount`): `GET /communication/customers/{id}/calls` resuelve ese UserId y
 * lista las llamadas donde participó = sus llamadas con la oficina. Muestra stats + lista estilo registro
 * de llamadas y permite llamar al cliente (audio/video) si tiene cuenta de portal.
 */
@Component({
  selector: 'app-client-profile-calls',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-calls.component.html',
})
export class ClientProfileCallsComponent implements OnChanges {
  private readonly calls = inject(CallsService);
  private readonly activeCall = inject(ActiveCallService);

  @Input() clientId = '';
  @Input() clientName = '';

  readonly loading = signal(false);
  readonly errored = signal(false);
  readonly items = signal<CustomerCallItem[]>([]);
  readonly stats = signal<CustomerCallsStats>({ total: 0, completed: 0, missed: 0, avgDurationSeconds: null });
  readonly hasPortalAccount = signal(false);
  private clientUserId: string | null = null;

  /** Deshabilita los botones mientras yo esté en otra llamada. */
  get callInProgress(): boolean {
    return this.activeCall.phase() !== 'idle';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['clientId'] && this.clientId) {
      this.load();
    }
  }

  private load(): void {
    this.loading.set(true);
    this.errored.set(false);
    this.calls.getCustomerCalls(this.clientId).subscribe({
      next: (res) => {
        this.items.set(res.items);
        this.stats.set(res.stats);
        this.hasPortalAccount.set(res.hasPortalAccount);
        this.clientUserId = res.clientUserId ?? null;
        this.loading.set(false);
      },
      error: () => {
        this.errored.set(true);
        this.loading.set(false);
      },
    });
  }

  startCall(kind: CallKind): void {
    if (!this.clientUserId || this.callInProgress) {
      return;
    }
    void this.activeCall.startCall(this.clientUserId, this.clientName || 'Client', kind);
  }

  /** "m:ss" o "—" si no hay duración. */
  formatDuration(seconds: number | null): string {
    if (!seconds || seconds <= 0) {
      return '—';
    }
    const s = Math.floor(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  avgDurationLabel(): string {
    const avg = this.stats().avgDurationSeconds;
    return avg && avg > 0 ? this.formatDuration(avg) : '—';
  }

  isMissed(item: CustomerCallItem): boolean {
    return item.status === 'MissedCall';
  }

  /** Etiqueta de estado legible para la fila. */
  statusLabel(item: CustomerCallItem): string {
    switch (item.status) {
      case 'MissedCall':
        return 'Missed';
      case 'Ended':
        return this.formatDuration(item.durationSeconds);
      case 'Rejected':
        return 'Declined';
      case 'Cancelled':
        return 'Cancelled';
      case 'Failed':
        return 'Failed';
      default:
        return item.status;
    }
  }

  /** Icono direccional/estado tipo registro de llamadas. */
  iconName(item: CustomerCallItem): string {
    if (item.status === 'MissedCall') {
      return 'arrow-down-outline';
    }
    return item.direction === 'incoming' ? 'arrow-down-outline' : 'arrow-up-outline';
  }

  kindIcon(item: CustomerCallItem): string {
    return item.kind === 'Video' ? 'videocam-outline' : 'call-outline';
  }

  formatWhen(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  trackById(_index: number, item: CustomerCallItem): string {
    return item.id;
  }
}
