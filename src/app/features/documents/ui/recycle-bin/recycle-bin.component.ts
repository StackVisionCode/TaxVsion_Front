import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface DeletedItem {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  deletedAt: string;
  size: string;
}

const SEED_DELETED: DeletedItem[] = [
  { id: 'r1', name: 'Old_W4_2023.pdf', kind: 'file', deletedAt: 'Jun 22, 2026', size: '310 KB' },
  { id: 'r2', name: 'Drafts', kind: 'folder', deletedAt: 'Jun 18, 2026', size: '4 items' },
  { id: 'r3', name: 'Duplicate_Receipt.jpg', kind: 'file', deletedAt: 'Jun 10, 2026', size: '1.8 MB' },
  { id: 'r4', name: 'Notes_old.doc', kind: 'file', deletedAt: 'May 29, 2026', size: '54 KB' },
];

/**
 * Papelera del módulo Documents (estilo "Aether"): summary cards + tabla con
 * acciones locales reales (Restore quita el ítem, Delete forever también).
 */
@Component({
  selector: 'app-recycle-bin',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './recycle-bin.component.html',
})
export class RecycleBinComponent {
  @Output() back = new EventEmitter<void>();

  readonly items = signal<DeletedItem[]>([...SEED_DELETED]);

  readonly fileCount = computed(() => this.items().filter(i => i.kind === 'file').length);
  readonly folderCount = computed(() => this.items().filter(i => i.kind === 'folder').length);

  restore(item: DeletedItem): void {
    this.items.update(items => items.filter(i => i.id !== item.id));
  }

  deleteForever(item: DeletedItem): void {
    this.items.update(items => items.filter(i => i.id !== item.id));
  }
}
