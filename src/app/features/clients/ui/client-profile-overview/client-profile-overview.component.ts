import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClientProfile } from '../../models/client-profile.model';

interface OverviewStat {
  title: string;
  subtitle: string;
  value: string;
  bg: string;
}

interface ActivityEntry {
  icon: string;
  iconClass: string;
  text: string;
  time: string;
}

/**
 * Tab "Overview" del perfil de cliente (patrón "Aether" tipo
 * dashboard-hero): fila de stat cards pastel + tarjeta de actividad
 * reciente con timeline. Datos mayormente estáticos; solo "Client since"
 * se deriva de createdAt.
 */
@Component({
  selector: 'app-client-profile-overview',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-overview.component.html',
})
export class ClientProfileOverviewComponent {
  @Input() client!: ClientProfile;

  readonly recentActivity: ActivityEntry[] = [
    {
      icon: 'receipt-outline',
      iconClass: 'bg-indigo-500',
      text: 'Invoice #INV-2026-0141 sent',
      time: '3 days ago',
    },
    {
      icon: 'document-text-outline',
      iconClass: 'bg-orange-500',
      text: 'Document uploaded: W-2 2025',
      time: '5 days ago',
    },
    {
      icon: 'create-outline',
      iconClass: 'bg-[#7C6AE0]',
      text: 'Signature request completed',
      time: '1 week ago',
    },
    {
      icon: 'chatbubble-ellipses-outline',
      iconClass: 'bg-green-500',
      text: 'Note added after phone call',
      time: '2 weeks ago',
    },
    {
      icon: 'mail-outline',
      iconClass: 'bg-gray-900',
      text: 'Welcome email sent',
      time: '1 month ago',
    },
  ];

  stats(): OverviewStat[] {
    return [
      {
        title: 'Client since',
        subtitle: 'Relationship length',
        value: this.clientSince(),
        bg: 'bg-[#F2E3C9]',
      },
      { title: 'Open invoices', subtitle: 'Awaiting payment', value: '2', bg: 'bg-[#CBD9F2]' },
      { title: 'Documents on file', subtitle: 'Stored in vault', value: '8', bg: 'bg-[#DCDCDC]' },
      { title: 'Last activity', subtitle: 'Most recent touch', value: '3 days ago', bg: 'bg-[#EEEBFA]' },
    ];
  }

  private clientSince(): string {
    const created = new Date(`${this.client.createdAt}T00:00:00`);
    const now = new Date();
    let months = (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth());
    if (now.getDate() < created.getDate()) {
      months -= 1;
    }
    months = Math.max(0, months);

    if (months < 12) {
      return `${months} ${months === 1 ? 'month' : 'months'}`;
    }
    const years = Math.floor(months / 12);
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }
}
