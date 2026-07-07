import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

type CommChannel = 'call' | 'sms' | 'email';
type CommFilter = 'all' | CommChannel;

interface CommEntry {
  id: string;
  channel: CommChannel;
  summary: string;
  timestamp: string;
}

const MOCK_ENTRIES: CommEntry[] = [
  { id: 'comm-1', channel: 'email', summary: 'Email: Invoice #INV-2026-0141 sent', timestamp: '2 hours ago' },
  { id: 'comm-2', channel: 'call', summary: 'Outbound call · 4 min', timestamp: 'Yesterday' },
  { id: 'comm-3', channel: 'sms', summary: 'SMS: Reminder sent for upcoming appointment', timestamp: '2 days ago' },
  { id: 'comm-4', channel: 'email', summary: 'Email: Requested missing 1099-NEC form', timestamp: '3 days ago' },
  { id: 'comm-5', channel: 'call', summary: 'Inbound call · 11 min', timestamp: '5 days ago' },
  { id: 'comm-6', channel: 'sms', summary: 'SMS: Confirmed document drop-off', timestamp: '1 week ago' },
  { id: 'comm-7', channel: 'email', summary: 'Email: Sent engagement letter for e-signature', timestamp: '2 weeks ago' },
  { id: 'comm-8', channel: 'call', summary: 'Outbound call · 2 min (no answer)', timestamp: '3 weeks ago' },
  { id: 'comm-9', channel: 'sms', summary: 'SMS: Reminder sent for Q1 estimated payment', timestamp: '1 month ago' },
  { id: 'comm-10', channel: 'email', summary: 'Email: Welcome packet and intake form sent', timestamp: '2 months ago' },
];

/**
 * Pestaña "Communication" del perfil de cliente (estilo "Aether"): registro
 * unificado de actividad (llamadas, SMS, emails) en orden reverso-cronológico
 * con círculo de ícono por canal y filtro por píldoras (All/Calls/SMS/Emails)
 * aplicado en el cliente vía signal + computed. Datos mock estáticos,
 * independientes del `clientId` recibido.
 */
@Component({
  selector: 'app-client-profile-communication',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-communication.component.html',
})
export class ClientProfileCommunicationComponent {
  @Input() clientId = '';

  readonly entries = signal<CommEntry[]>([...MOCK_ENTRIES]);
  readonly activeFilter = signal<CommFilter>('all');

  readonly filters: { value: CommFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'call', label: 'Calls' },
    { value: 'sms', label: 'SMS' },
    { value: 'email', label: 'Emails' },
  ];

  readonly visibleEntries = computed(() => {
    const filter = this.activeFilter();
    if (filter === 'all') {
      return this.entries();
    }
    return this.entries().filter(entry => entry.channel === filter);
  });

  setFilter(filter: CommFilter): void {
    this.activeFilter.set(filter);
  }

  channelIcon(channel: CommChannel): string {
    switch (channel) {
      case 'call':
        return 'call-outline';
      case 'sms':
        return 'chatbox-outline';
      case 'email':
        return 'mail-outline';
    }
  }

  channelCircle(channel: CommChannel): string {
    switch (channel) {
      case 'call':
        return 'bg-emerald-500';
      case 'sms':
        return 'bg-orange-500';
      case 'email':
        return 'bg-indigo-500';
    }
  }
}
