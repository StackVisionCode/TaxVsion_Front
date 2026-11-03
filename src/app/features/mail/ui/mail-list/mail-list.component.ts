import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  QueryList,
  ViewChild,
  ViewChildren,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { LoadMoreComponent } from '@shared/ui/load-more/load-more.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';

/** Etiqueta de la fila: el cliente del correo, o "Not a client" (atenuada). */
export interface MailRowTag {
  label: string;
  muted: boolean;
}

/** Chip de estado de entrega de la fila ("Not delivered" rojo, "Mailbox full" ámbar, "Delayed" gris…). */
export interface MailRowStatus {
  label: string;
  tone: 'red' | 'amber' | 'gray' | 'green';
}

/**
 * Fila del listado central, ya aplanada por mail-page desde `ThreadSummary`
 * (Inbox/Archived), `SentMessageListItem`, `DraftListItem` o `TrashItem`.
 */
export interface MailListRow {
  /** threadId, messageId o draftId, según la carpeta activa. */
  id: string;
  /** Texto del que salen las iniciales del avatar (`initialsOf`, vía `app-avatar`). */
  avatarName: string;
  avatarColor: string;
  /** Primera línea: remitente o destinatario (o el asunto en drafts). */
  title: string;
  /** Segunda línea: asunto, o el tipo de draft. */
  subtitle: string;
  /** Tercera línea opcional: vista previa del último correo entrante. */
  preview?: string | null;
  /** De qué cliente es el correo; null cuando un filtro ya lo dice. */
  tag?: MailRowTag | null;
  /** El hilo tiene adjuntos (sin número: el resumen del hilo no lo trae). */
  hasAttachments?: boolean;
  /** Fecha formateada (última actividad del hilo / última edición del draft). */
  time: string;
  /** Chip opcional: "Archived", o el estado del draft cuando no es `Draft`. */
  badge: string | null;
  /** Correos inbound no leídos del hilo (0 fuera del Inbox). Pinta el hilo en negrita + globo. */
  unreadCount: number;
  /** No leído sin conteo (resultados de búsqueda): negrita + punto, sin globo. */
  unread?: boolean;
  /** Adjuntos de la fila (carpeta Sent): >0 pinta un clip. Ausente/0 = sin indicador. */
  attachmentCount?: number;
  /** Estado de entrega (aviso de no entrega del hilo o estado del enviado). */
  status?: MailRowStatus | null;
  /** Icono en lugar del avatar (p. ej. un archivo en los resultados de búsqueda). */
  icon?: string | null;
  /** La vista previa es un aviso (se pinta en el color del estado). */
  previewTone?: MailRowStatus['tone'] | null;
}

/**
 * Listado central del módulo Mail (estilo "Aether"): filas con avatar de iniciales, asunto, meta y
 * fecha. La fila seleccionada se resalta con un pill negro que se DESLIZA entre filas (mismo patrón que
 * el indicador del sidebar y del rail de carpetas).
 *
 * Sigue siendo dumb: recibe filas ya armadas más los estados de carga del store y emite selección /
 * retry / paginación. La búsqueda vive fuera (`app-grouped-search` en mail-page) y llega ya aplicada.
 */
@Component({
  selector: 'app-mail-list',
  imports: [CommonModule, AvatarComponent, LoadMoreComponent, StateBlockComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-list.component.html',
  styleUrl: './mail-list.component.css',
})
export class MailListComponent implements OnChanges, AfterViewInit {
  /** Input respaldado por signal para que el filtrado sea un computed. */
  private readonly rowsSig = signal<MailListRow[]>([]);

  @Input() set rows(value: MailListRow[]) {
    this.rowsSig.set(value ?? []);
  }

  @Input() selectedId: string | null = null;
  @Input() loading = false;
  @Input() loadingMore = false;
  @Input() error: string | null = null;
  @Input() hasMore = false;
  /** Texto del estado vacío honesto según el contexto (sin cliente, carpeta vacía…). */
  @Input() emptyText = 'Nothing here yet';
  /** Papelera: muestra botones Restore / Delete-forever por fila. */
  @Input() showTrashActions = false;
  /** Texto de apoyo bajo el estado vacío (p. ej. qué probar en una búsqueda sin resultados). */
  @Input() emptyHint = '';

  @Output() rowSelected = new EventEmitter<string>();
  @Output() retryRequested = new EventEmitter<void>();
  @Output() loadMoreRequested = new EventEmitter<void>();
  @Output() restoreRequested = new EventEmitter<string>();
  @Output() purgeRequested = new EventEmitter<string>();
  /** B6 — restaurar y borrar para siempre exigen `correspondence.manage`, no `read`. */
  @Input() canManage = true;

  @ViewChild('listScroll') private scrollRef?: ElementRef<HTMLElement>;
  @ViewChildren('rowButton') private rowButtons?: QueryList<ElementRef<HTMLElement>>;

  /** Posición/tamaño del pill deslizante que resalta la fila seleccionada. */
  readonly indicatorTop = signal(0);
  readonly indicatorLeft = signal(0);
  readonly indicatorWidth = signal(0);
  readonly indicatorHeight = signal(0);
  readonly indicatorReady = signal(false);

  /** Las filas llegan ya filtradas (búsqueda y chips se aplican en el store / la página). */
  readonly filteredRows = computed<MailListRow[]>(() => this.rowsSig());

  ngAfterViewInit(): void {
    setTimeout(() => this.syncIndicator());
    setTimeout(() => this.syncIndicator(), 300);
    // La lista cambia con la carpeta/búsqueda/paginación: re-medir cuando cambian los botones.
    this.rowButtons?.changes.subscribe(() => setTimeout(() => this.syncIndicator()));
  }

  ngOnChanges(changes: SimpleChanges): void {
    setTimeout(() => this.syncIndicator());
    // Moverse con j/k puede dejar la fila elegida fuera de la vista: se trae sin saltos bruscos.
    if (changes['selectedId'] && this.selectedId) {
      setTimeout(() => this.scrollSelectedIntoView());
    }
  }

  private scrollSelectedIntoView(): void {
    const index = this.filteredRows().findIndex(row => row.id === this.selectedId);
    this.rowButtons?.toArray()[index]?.nativeElement.scrollIntoView({ block: 'nearest' });
  }

  isUnread(row: MailListRow): boolean {
    return row.unreadCount > 0 || !!row.unread;
  }

  /** Lo que un lector de pantalla dice de la fila: remitente, asunto, no leídos, cliente y fecha. */
  rowLabel(row: MailListRow): string {
    return [
      row.title,
      row.subtitle,
      row.unreadCount > 0 ? `${row.unreadCount} unread` : row.unread ? 'unread' : null,
      row.tag?.label ?? null,
      row.status?.label ?? null,
      (row.attachmentCount ?? 0) > 0 || row.hasAttachments ? 'has attachments' : null,
      row.badge,
      row.time,
    ]
      .filter(Boolean)
      .join(', ');
  }

  @HostListener('window:resize')
  onResize(): void {
    this.syncIndicator();
  }

  statusClasses(status: MailRowStatus, selected: boolean): string {
    if (selected) {
      return 'bg-white/15 text-white';
    }
    switch (status.tone) {
      case 'red':
        return 'bg-red-50 text-red-700';
      case 'amber':
        return 'bg-amber-50 text-amber-700';
      case 'green':
        return 'bg-emerald-50 text-emerald-700';
      default:
        return 'bg-gray-100 text-gray-500';
    }
  }

  previewClasses(row: MailListRow, selected: boolean): string {
    if (selected) {
      return 'text-gray-300';
    }
    return row.previewTone === 'red' ? 'text-red-600' : row.previewTone === 'amber' ? 'text-amber-700' : 'text-gray-400';
  }

  select(id: string): void {
    this.rowSelected.emit(id);
  }

  trackByRowId(_index: number, row: MailListRow): string {
    return row.id;
  }

  private syncIndicator(): void {
    const container = this.scrollRef?.nativeElement;
    const buttons = this.rowButtons?.toArray();
    if (!container || !buttons?.length || this.selectedId === null) {
      this.indicatorReady.set(false);
      return;
    }

    const activeIndex = this.filteredRows().findIndex(row => row.id === this.selectedId);
    const activeButton = activeIndex >= 0 ? buttons[activeIndex]?.nativeElement : undefined;
    if (!activeButton) {
      this.indicatorReady.set(false);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();

    this.indicatorTop.set(buttonRect.top - containerRect.top + container.scrollTop);
    this.indicatorLeft.set(buttonRect.left - containerRect.left + container.scrollLeft);
    this.indicatorWidth.set(buttonRect.width);
    this.indicatorHeight.set(buttonRect.height);
    this.indicatorReady.set(true);
  }
}
