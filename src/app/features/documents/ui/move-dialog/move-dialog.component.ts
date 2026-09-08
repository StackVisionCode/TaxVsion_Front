import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  computed,
  signal,
} from '@angular/core';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { FolderTreeNode } from '../../data-access/documents.model';

/** Fila aplanada del árbol (nivel = profundidad para el sangrado). */
interface FlatFolder {
  id: string;
  name: string;
  depth: number;
}

/**
 * Selector de destino para "mover" un archivo o carpeta. Aplana el árbol del
 * dueño actual en filas con sangría. Al mover una carpeta se excluye ella misma
 * y su subárbol (no se puede mover dentro de sí). "Move here" con destino null
 * = raíz del dueño.
 */
@Component({
  selector: 'app-move-dialog',
  imports: [ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <app-modal [isOpen]="isOpen" [heading]="'Move ' + itemLabel" size="md" (closed)="cancelled.emit()">
      <div class="mt-5 max-h-72 overflow-y-auto rounded-2xl border border-gray-200 p-1.5">
        <button type="button" (click)="target.set(null)"
          class="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors"
          [class]="target() === null ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-gray-700 hover:bg-gray-50'">
          <ion-icon [name]="rootIcon" class="text-base"></ion-icon>
          <span>{{ rootLabel }}</span>
        </button>
        @for (folder of flat(); track folder.id) {
          <button type="button" (click)="target.set(folder.id)"
            class="flex w-full items-center gap-2 rounded-xl py-2 pr-2.5 text-left text-sm transition-colors"
            [class]="target() === folder.id ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-gray-700 hover:bg-gray-50'"
            [style.padding-left.px]="10 + folder.depth * 18">
            <ion-icon name="folder-outline" class="text-base"></ion-icon>
            <span class="truncate">{{ folder.name }}</span>
          </button>
        }
      </div>

      <p class="mt-3.5 flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-500">
        <ion-icon name="information-circle-outline" class="mt-0.5 text-sm"></ion-icon>
        <span>Files stay with the same owner. Moving only changes the folder they live in.</span>
      </p>

      <div class="mt-6 flex items-center justify-end gap-2">
        <button type="button" (click)="cancelled.emit()"
          class="rounded-full px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900">
          Cancel
        </button>
        <button type="button" (click)="moved.emit(target())"
          class="rounded-full bg-brand-bold px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-ink">
          Move here
        </button>
      </div>
    </app-modal>
  `,
})
export class MoveDialogComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() tree: FolderTreeNode[] = [];
  @Input() rootLabel = 'Root';
  @Input() rootIcon = 'business-outline';
  @Input() itemLabel = '';
  /** Carpeta que se está moviendo (para excluirla a ella y su subárbol); null si es un archivo. */
  @Input() excludeFolderId: string | null = null;
  @Output() moved = new EventEmitter<string | null>();
  @Output() cancelled = new EventEmitter<void>();

  readonly target = signal<string | null>(null);
  private readonly treeSig = signal<FolderTreeNode[]>([]);

  readonly flat = computed<FlatFolder[]>(() => {
    const rows: FlatFolder[] = [];
    const walk = (nodes: FolderTreeNode[], depth: number): void => {
      for (const node of nodes) {
        if (node.id === this.excludeFolderId) {
          continue; // se salta la carpeta movida y todo su subárbol
        }
        rows.push({ id: node.id, name: node.name, depth });
        walk(node.children ?? [], depth + 1);
      }
    };
    walk(this.treeSig(), 0);
    return rows;
  });

  ngOnChanges(): void {
    this.treeSig.set(this.tree);
    if (this.isOpen) {
      this.target.set(null);
    }
  }
}
