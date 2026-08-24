import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DocumentsClientSummary } from '../../data-access/documents-clients.service';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Selector de cliente del módulo Documents (estilo "Aether"): búsqueda píldora
 * y tabla con header píldora. Presentacional puro — la lista viene de
 * DocumentsStore (GET /customers) vía el contenedor `documents-page`; acá solo
 * se debounce el texto de búsqueda antes de emitirlo.
 */
@Component({
  selector: 'app-client-picker',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-picker.component.html',
})
export class ClientPickerComponent {
  @Input() clients: DocumentsClientSummary[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;
  @Output() search = new EventEmitter<string>();
  @Output() clientSelected = new EventEmitter<DocumentsClientSummary>();

  readonly searchTerm = signal('');
  private searchDebounce: ReturnType<typeof setTimeout> | undefined;

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.search.emit(value), SEARCH_DEBOUNCE_MS);
  }

  initials(client: DocumentsClientSummary): string {
    const words = client.displayName.trim().split(/\s+/);
    return words.length >= 2
      ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
      : client.displayName.substring(0, 2).toUpperCase();
  }

  avatarClass(index: number): string {
    const palette = ['bg-brand-bold', 'bg-sky-700', 'bg-brand-ink', 'bg-slate-500', 'bg-indigo-400'];
    return palette[index % palette.length];
  }

  statusChip(client: DocumentsClientSummary): string {
    return client.status === 'Active' ? 'border-emerald-200 text-emerald-600' : 'border-gray-300 text-gray-500';
  }
}
