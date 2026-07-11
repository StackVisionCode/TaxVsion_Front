import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type FileKind = 'pdf' | 'xlsx' | 'img' | 'doc';

interface DocFolder {
  id: string;
  name: string;
  parentId: string | null;
}

interface DocFile {
  id: string;
  name: string;
  folderId: string | null;
  size: string;
  date: string;
  kind: FileKind;
}

const SEED_FOLDERS: DocFolder[] = [
  { id: 'f1', name: 'Tax Returns 2025', parentId: null },
  { id: 'f2', name: 'W-2 Forms', parentId: null },
  { id: 'f3', name: 'Receipts', parentId: null },
  { id: 'f4', name: 'Q1', parentId: 'f3' },
  { id: 'f5', name: 'Q2', parentId: 'f3' },
];

const SEED_FILES: DocFile[] = [
  { id: 'd1', name: '2025_Individual_Tax_Return.pdf', folderId: 'f1', size: '2.4 MB', date: 'Jun 28, 2026', kind: 'pdf' },
  { id: 'd2', name: 'Federal_Extension_4868.pdf', folderId: 'f1', size: '640 KB', date: 'Jun 12, 2026', kind: 'pdf' },
  { id: 'd3', name: 'W2_Employer_Copy.pdf', folderId: 'f2', size: '480 KB', date: 'May 30, 2026', kind: 'pdf' },
  { id: 'd4', name: 'W2_Spouse.pdf', folderId: 'f2', size: '455 KB', date: 'May 30, 2026', kind: 'pdf' },
  { id: 'd5', name: 'Office_Supplies_March.xlsx', folderId: 'f4', size: '88 KB', date: 'Apr 2, 2026', kind: 'xlsx' },
  { id: 'd6', name: 'Mileage_Log_Q1.xlsx', folderId: 'f4', size: '102 KB', date: 'Apr 5, 2026', kind: 'xlsx' },
  { id: 'd7', name: 'Home_Office_Photo.jpg', folderId: 'f5', size: '3.1 MB', date: 'Jun 20, 2026', kind: 'img' },
  { id: 'd8', name: 'Utilities_Invoice_May.pdf', folderId: 'f5', size: '210 KB', date: 'Jun 1, 2026', kind: 'pdf' },
  { id: 'd9', name: 'Engagement_Letter_signed.pdf', folderId: null, size: '1.1 MB', date: 'Jun 30, 2026', kind: 'pdf' },
  { id: 'd10', name: 'Client_Intake_Form.doc', folderId: null, size: '96 KB', date: 'Jan 15, 2026', kind: 'doc' },
  { id: 'd11', name: 'Prior_Year_Return_2024.pdf', folderId: null, size: '2.2 MB', date: 'Feb 3, 2026', kind: 'pdf' },
  { id: 'd12', name: 'Bank_Statements_2025.xlsx', folderId: null, size: '540 KB', date: 'Mar 22, 2026', kind: 'xlsx' },
];

/**
 * Explorador de archivos del módulo Documents (estilo "Aether"): breadcrumbs
 * píldora, toggle tabla/grid, búsqueda local y navegación real entre carpetas
 * fake. "New folder" y "Upload" agregan de verdad a la lista local (el tipo
 * de archivo se infiere de la extensión real elegida; no hay parseo/preview
 * de contenido, solo metadata).
 */
@Component({
  selector: 'app-file-browser',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './file-browser.component.html',
})
export class FileBrowserComponent {
  @Input() clientName = '';
  @Output() back = new EventEmitter<void>();
  @Output() openRecycleBin = new EventEmitter<void>();

  readonly folders = signal<DocFolder[]>([...SEED_FOLDERS]);
  readonly files = signal<DocFile[]>([...SEED_FILES]);
  readonly currentFolderId = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly viewMode = signal<'table' | 'grid'>('table');

  readonly breadcrumbs = computed<DocFolder[]>(() => {
    const chain: DocFolder[] = [];
    let id = this.currentFolderId();
    const byId = new Map(this.folders().map(f => [f.id, f]));
    while (id) {
      const folder = byId.get(id);
      if (!folder) break;
      chain.unshift(folder);
      id = folder.parentId;
    }
    return chain;
  });

  readonly visibleFolders = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    return this.folders().filter(
      f => f.parentId === this.currentFolderId() && (!term || f.name.toLowerCase().includes(term)),
    );
  });

  readonly visibleFiles = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    return this.files().filter(
      f => f.folderId === this.currentFolderId() && (!term || f.name.toLowerCase().includes(term)),
    );
  });

  readonly isEmpty = computed(() => this.visibleFolders().length === 0 && this.visibleFiles().length === 0);

  openFolder(folder: DocFolder): void {
    this.currentFolderId.set(folder.id);
    this.searchTerm.set('');
  }

  goToRoot(): void {
    this.currentFolderId.set(null);
    this.searchTerm.set('');
  }

  goToBreadcrumb(folder: DocFolder): void {
    this.currentFolderId.set(folder.id);
    this.searchTerm.set('');
  }

  addFolder(): void {
    const count = this.folders().filter(f => f.parentId === this.currentFolderId()).length + 1;
    this.folders.update(folders => [
      ...folders,
      { id: `f-new-${Date.now()}`, name: `New folder ${count}`, parentId: this.currentFolderId() },
    ]);
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) {
      return;
    }
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const folderId = this.currentFolderId();
    const uploaded: DocFile[] = Array.from(files).map((file, index) => ({
      id: `d-new-${Date.now()}-${index}`,
      name: file.name,
      folderId,
      size: this.formatSize(file.size),
      date: today,
      kind: this.kindFromFileName(file.name),
    }));
    this.files.update(list => [...list, ...uploaded]);
    input.value = '';
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private kindFromFileName(name: string): FileKind {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      return 'xlsx';
    }
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      return 'img';
    }
    if (['doc', 'docx'].includes(ext)) {
      return 'doc';
    }
    return 'pdf';
  }

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

  kindChip(kind: FileKind): string {
    switch (kind) {
      case 'pdf':
        return 'border-orange-200 text-orange-500';
      case 'xlsx':
        return 'border-emerald-200 text-emerald-600';
      case 'img':
        return 'border-gray-300 text-gray-600';
      case 'doc':
        return 'border-indigo-200 text-indigo-600';
    }
  }
}
