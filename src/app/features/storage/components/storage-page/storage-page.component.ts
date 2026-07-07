import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PaginationComponent } from '../../../../shared/ui/pagination/pagination.component';
import { UsedStorageCardComponent } from '../../../../shared/ui/used-storage-card/used-storage-card.component';

interface StorageGroup {
  name: string;
  icon: string;
  /** Color sólido (hex) compartido por el punto de la leyenda, el donut y el círculo de la tarjeta. */
  color: string;
  fileCount: number;
  sizeBytes: number;
  lastUpdate: string;
}

interface SharedFile {
  id: string;
  name: string;
  icon: string;
  /** Nombre de categoría; debe coincidir con uno de los `StorageGroup.name`. */
  category: string;
  /** Iniciales de con quién está compartido; vacío = "Only you". */
  sharedWith: string[];
  date: string;
  sizeBytes: number;
}

interface StorageContact {
  name: string;
  email: string;
  initials: string;
  color: string;
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/**
 * Grupos de almacenamiento (mismo agrupamiento que el diseño de referencia:
 * Documents / Images / Video & Audio / Others / Trash). Suman ~42 GB de un
 * total de 100 GB; los colores vienen de la paleta de acentos de la app.
 */
const SEED_GROUPS: StorageGroup[] = [
  { name: 'Documents', icon: 'document-text-outline', color: '#7C6AE0', fileCount: 3540, sizeBytes: Math.round(12.4 * GB), lastUpdate: '10:15 am, Jul 2' },
  { name: 'Images', icon: 'image-outline', color: '#6AA7E0', fileCount: 1240, sizeBytes: Math.round(9.6 * GB), lastUpdate: '4:42 pm, Jul 4' },
  { name: 'Video & Audio', icon: 'videocam-outline', color: '#5FBFA3', fileCount: 426, sizeBytes: Math.round(14.7 * GB), lastUpdate: '9:08 am, Jul 5' },
  { name: 'Others', icon: 'ellipsis-horizontal-circle-outline', color: '#E0A16A', fileCount: 161, sizeBytes: Math.round(3.3 * GB), lastUpdate: '1:27 pm, Jun 29' },
  { name: 'Trash', icon: 'trash-outline', color: '#E06A9A', fileCount: 89, sizeBytes: Math.round(2.1 * GB), lastUpdate: '11:50 am, Jun 25' },
];

/** Todos los archivos del feature Storage; la tabla se filtra por `category` según la tarjeta seleccionada arriba. */
const SEED_FILES: SharedFile[] = [
  { id: 'file-1', name: 'Q4_Tax_Planning_Deck.pptx', icon: 'easel-outline', category: 'Documents', sharedWith: ['MA', 'RK', 'ST'], date: 'Jul 5, 2026', sizeBytes: Math.round(298 * MB) },
  { id: 'file-2', name: 'Signed_Engagement_Letters.pdf', icon: 'document-text-outline', category: 'Documents', sharedWith: [], date: 'Jul 4, 2026', sizeBytes: Math.round(12 * MB) },
  { id: 'file-3', name: 'Annual_Financial_Statements_2025.xlsx', icon: 'grid-outline', category: 'Documents', sharedWith: ['MA'], date: 'Jul 1, 2026', sizeBytes: Math.round(412 * MB) },
  { id: 'file-4', name: 'Employee_Handbook_2026.docx', icon: 'document-outline', category: 'Documents', sharedWith: ['ST'], date: 'Jun 26, 2026', sizeBytes: Math.round(156 * MB) },
  { id: 'file-5', name: 'Scanned_Receipts_Batch3.pdf', icon: 'document-text-outline', category: 'Documents', sharedWith: [], date: 'Jun 30, 2026', sizeBytes: Math.round(634 * MB) },
  { id: 'file-6', name: 'IRS_Audit_Documents_Merged.pdf', icon: 'document-text-outline', category: 'Documents', sharedWith: [], date: 'Jun 24, 2026', sizeBytes: Math.round(245 * MB) },
  { id: 'file-7', name: 'Signed_Contract_Scan_HighRes.tiff', icon: 'image-outline', category: 'Images', sharedWith: ['RK'], date: 'Jun 20, 2026', sizeBytes: Math.round(187 * MB) },
  { id: 'file-8', name: 'Office_Team_Photo.jpg', icon: 'image-outline', category: 'Images', sharedWith: [], date: 'Jun 18, 2026', sizeBytes: Math.round(8 * MB) },
  { id: 'file-9', name: 'Storefront_Signage_Mockup.png', icon: 'image-outline', category: 'Images', sharedWith: ['DP'], date: 'Jun 12, 2026', sizeBytes: Math.round(22 * MB) },
  { id: 'file-10', name: 'Client_Portal_Demo_Recording.mp4', icon: 'videocam-outline', category: 'Video & Audio', sharedWith: ['DP', 'PS'], date: 'Jul 3, 2026', sizeBytes: Math.round(578 * MB) },
  { id: 'file-11', name: 'Q4_Video_Training.mp4', icon: 'videocam-outline', category: 'Video & Audio', sharedWith: [], date: 'Jun 15, 2026', sizeBytes: Math.round(892 * MB) },
  { id: 'file-12', name: 'Client_Interview_Audio_Notes.mp3', icon: 'musical-notes-outline', category: 'Video & Audio', sharedWith: ['ST'], date: 'Jun 11, 2026', sizeBytes: Math.round(98 * MB) },
  { id: 'file-13', name: '2025_Client_Backup.zip', icon: 'archive-outline', category: 'Others', sharedWith: ['RK', 'CM', 'PS'], date: 'Jun 28, 2026', sizeBytes: Math.round(1.24 * GB) },
  { id: 'file-14', name: 'Misc_Templates_Bundle.rar', icon: 'archive-outline', category: 'Others', sharedWith: [], date: 'Jun 5, 2026', sizeBytes: Math.round(340 * MB) },
  { id: 'file-15', name: 'Old_Onboarding_Flyer.pdf', icon: 'trash-outline', category: 'Trash', sharedWith: [], date: 'Jun 2, 2026', sizeBytes: Math.round(4 * MB) },
  { id: 'file-16', name: 'Duplicate_Invoice_Draft.docx', icon: 'trash-outline', category: 'Trash', sharedWith: ['CM'], date: 'May 28, 2026', sizeBytes: Math.round(2 * MB) },
];

const SEED_CONTACTS: StorageContact[] = [
  { name: 'Maria Alvarez', email: 'maria.alvarez@example.com', initials: 'MA', color: 'bg-[#7C6AE0]' },
  { name: 'Robert Kim', email: 'robert.kim@example.com', initials: 'RK', color: 'bg-[#6AA7E0]' },
  { name: 'Sofia Torres', email: 'sofia.torres@example.com', initials: 'ST', color: 'bg-[#5FBFA3]' },
  { name: 'David Park', email: 'david.park@example.com', initials: 'DP', color: 'bg-[#E0A16A]' },
  { name: 'Priya Sharma', email: 'priya.sharma@example.com', initials: 'PS', color: 'bg-[#E06A9A]' },
  { name: 'Carlos Mendes', email: 'carlos.mendes@example.com', initials: 'CM', color: 'bg-[#A99BEB]' },
];

const PAGE_SIZE = 8;
/** Estáticos para el bloque "Storage Type" del card de uso. */
const UPLOAD_BYTES = Math.round(31.2 * GB);
const DOWNLOAD_BYTES = Math.round(10.9 * GB);

/**
 * Página del feature Storage, rediseñada según la referencia del usuario:
 * tarjeta "Used Storage" con donut de puntos segmentados por categoría +
 * leyenda + tipo de almacenamiento, fila de tarjetas de categorías con
 * "Last update" (clickeables para filtrar) y una tabla paginada "All Files"
 * con avatares de "shared with" y botón Share (toast local). Todo visual con
 * signals estáticos, sin servicios ni backend; la gestión real de archivos
 * vive en Documents.
 */
@Component({
  selector: 'app-storage-page',
  imports: [CommonModule, RouterLink, PaginationComponent, UsedStorageCardComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './storage-page.component.html',
  styleUrl: './storage-page.component.css',
})
export class StoragePageComponent {
  readonly totalBytes = 100 * GB;
  readonly uploadBytes = UPLOAD_BYTES;
  readonly downloadBytes = DOWNLOAD_BYTES;

  readonly groups = signal<StorageGroup[]>(SEED_GROUPS);
  readonly files = signal<SharedFile[]>(SEED_FILES);
  readonly contacts = SEED_CONTACTS;

  readonly showAllCategories = signal(false);
  readonly toast = signal<string | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  /** Categoría activa para filtrar la tabla de archivos; null = todas. */
  readonly selectedCategory = signal<string | null>(null);
  readonly currentPage = signal(1);
  readonly pageSize = PAGE_SIZE;

  /** Tarjetas visibles: las 3 primeras, o todas al tocar "View All". */
  readonly visibleGroups = computed(() => (this.showAllCategories() ? this.groups() : this.groups().slice(0, 3)));

  /** Archivos filtrados por la categoría seleccionada (todas si no hay ninguna activa). */
  readonly filteredFiles = computed<SharedFile[]>(() => {
    const category = this.selectedCategory();
    return category ? this.files().filter(file => file.category === category) : this.files();
  });

  /** Página actual del filtrado, para la tabla. */
  readonly pagedFiles = computed<SharedFile[]>(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.filteredFiles().slice(start, start + PAGE_SIZE);
  });

  toggleCategories(): void {
    this.showAllCategories.update(value => !value);
  }

  /** Al hacer click en una tarjeta de categoría, filtra la tabla; un segundo click sobre la misma la limpia. */
  selectCategory(name: string): void {
    this.selectedCategory.update(current => (current === name ? null : name));
    this.currentPage.set(1);
  }

  clearCategoryFilter(): void {
    this.selectedCategory.set(null);
    this.currentPage.set(1);
  }

  /** Simula compartir: solo muestra un toast transitorio, no hay backend. */
  shareFile(file: SharedFile): void {
    this.showToast(`Share link copied for ${file.name}`);
  }

  contactColor(initials: string): string {
    return this.contacts.find(contact => contact.initials === initials)?.color ?? 'bg-gray-400';
  }

  /** Color hex de la categoría (mismo que su tarjeta/donut), usado para el chip de la tabla. */
  categoryColor(categoryName: string): string {
    return this.groups().find(group => group.name === categoryName)?.color ?? '#9CA3AF';
  }

  formatBytes(bytes: number): string {
    if (bytes <= 0) {
      return '0 KB';
    }
    if (bytes >= GB) {
      return `${(bytes / GB).toFixed(1)} GB`;
    }
    if (bytes >= MB) {
      return `${Math.round(bytes / MB)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  private showToast(message: string): void {
    this.toast.set(message);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 2200);
  }
}
