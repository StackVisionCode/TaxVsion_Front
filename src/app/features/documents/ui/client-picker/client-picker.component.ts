import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface DocumentsClient {
  id: string;
  name: string;
  email: string;
  docCount: number;
  lastUpload: string;
}

const CLIENTS: DocumentsClient[] = [
  { id: 'c1', name: 'Maria Gonzalez', email: 'maria.gonzalez@example.com', docCount: 24, lastUpload: '2 days ago' },
  { id: 'c2', name: 'David Chen', email: 'david.chen@example.com', docCount: 11, lastUpload: '1 week ago' },
  { id: 'c3', name: 'Acme Corp', email: 'billing@acmecorp.com', docCount: 42, lastUpload: 'Yesterday' },
  { id: 'c4', name: 'Sarah Kim', email: 'sarah.kim@example.com', docCount: 8, lastUpload: '3 weeks ago' },
  { id: 'c5', name: 'Alvarez Family Trust', email: 'contact@alvarezfamily.com', docCount: 17, lastUpload: '5 days ago' },
  { id: 'c6', name: 'Riverside Bakery', email: 'owner@riversidebakery.com', docCount: 6, lastUpload: '1 month ago' },
];

/**
 * Selector de cliente del módulo Documents (estilo "Aether"): búsqueda píldora
 * y tabla con header píldora. Visual-only: clientes estáticos, filtrado local.
 */
@Component({
  selector: 'app-client-picker',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-picker.component.html',
})
export class ClientPickerComponent {
  @Output() clientSelected = new EventEmitter<DocumentsClient>();

  readonly searchTerm = signal('');

  readonly filteredClients = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) {
      return CLIENTS;
    }
    return CLIENTS.filter(
      c => c.name.toLowerCase().includes(term) || c.email.toLowerCase().includes(term),
    );
  });

  initials(client: DocumentsClient): string {
    const words = client.name.trim().split(/\s+/);
    return words.length >= 2
      ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
      : client.name.substring(0, 2).toUpperCase();
  }

  avatarClass(index: number): string {
    const palette = ['bg-gray-900', 'bg-indigo-600', 'bg-[#7C6AE0]', 'bg-orange-500', 'bg-emerald-500'];
    return palette[index % palette.length];
  }
}
