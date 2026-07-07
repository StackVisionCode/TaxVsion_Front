import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type FileKind = 'pdf' | 'xlsx' | 'img' | 'doc';

interface ClientDocument {
  id: string;
  name: string;
  date: string;
  size: string;
  kind: FileKind;
}

const MOCK_DOCUMENTS: ClientDocument[] = [
  { id: 'doc-1', name: '2025_Individual_Tax_Return.pdf', date: 'Jun 28, 2026', size: '2.4 MB', kind: 'pdf' },
  { id: 'doc-2', name: 'W2_Employer_Copy.pdf', date: 'May 30, 2026', size: '480 KB', kind: 'pdf' },
  { id: 'doc-3', name: 'Mileage_Log_Q1.xlsx', date: 'Apr 5, 2026', size: '102 KB', kind: 'xlsx' },
  { id: 'doc-4', name: 'Home_Office_Photo.jpg', date: 'Jun 20, 2026', size: '3.1 MB', kind: 'img' },
  { id: 'doc-5', name: 'Engagement_Letter_signed.pdf', date: 'Jun 30, 2026', size: '1.1 MB', kind: 'pdf' },
  { id: 'doc-6', name: 'Client_Intake_Form.doc', date: 'Jan 15, 2026', size: '96 KB', kind: 'doc' },
  { id: 'doc-7', name: 'Bank_Statements_2025.xlsx', date: 'Mar 22, 2026', size: '540 KB', kind: 'xlsx' },
  { id: 'doc-8', name: 'Prior_Year_Return_2024.pdf', date: 'Feb 3, 2026', size: '2.2 MB', kind: 'pdf' },
];

/**
 * Pestaña "Documents" del perfil de cliente (estilo "Aether"): lista plana
 * (sin carpetas) de archivos con círculo de ícono por tipo, búsqueda local
 * por nombre y un botón fantasma de descarga (inerte, solo visual). Los
 * datos son mock estáticos independientes del `clientId` recibido.
 */
@Component({
  selector: 'app-client-profile-documents',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-documents.component.html',
})
export class ClientProfileDocumentsComponent {
  @Input() clientId = '';

  readonly documents = signal<ClientDocument[]>([...MOCK_DOCUMENTS]);
  readonly searchTerm = signal('');

  readonly visibleDocuments = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) {
      return this.documents();
    }
    return this.documents().filter(doc => doc.name.toLowerCase().includes(term));
  });

  kindIcon(kind: FileKind): string {
    switch (kind) {
      case 'pdf':
        return 'document-text-outline';
      case 'xlsx':
        return 'stats-chart-outline';
      case 'img':
        return 'image-outline';
      case 'doc':
        return 'document-outline';
    }
  }

  kindCircle(kind: FileKind): string {
    switch (kind) {
      case 'pdf':
        return 'bg-[#F2E3C9]';
      case 'xlsx':
        return 'bg-[#CBD9F2]';
      case 'img':
        return 'bg-[#DCDCDC]';
      case 'doc':
        return 'bg-[#EEEBFA]';
    }
  }
}
