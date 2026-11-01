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
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { LoadMoreComponent } from '@shared/ui/load-more/load-more.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';

/** Etiqueta de la fila: el cliente del correo, o "Not a client" (atenuada). */
export interface MailRowTag {
  label: string;
  muted: boolean;
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
  /** Adjuntos de la fila (carpeta Sent): >0 pinta un clip. Ausente/0 = sin indicador. */
  attachmentCount?: number;
}

/**
 * Listado central del módulo Mail (estilo "Aether"): buscador píldora + filas
 * con avatar de iniciales, asunto, meta y fecha. La fila seleccionada se
 * resalta con un pill negro que se DESLIZA entre filas (mismo patrón que el
 * indicador del sidebar y del rail de carpetas).
 *
 * Sigue siendo dumb: recibe filas ya armadas más los estados de carga del store
 * y emite selección / retry / paginación. Con `serverSearch` lo tecleado sube al padre (Inbox/Archived
 * buscan en el servidor); sin él filtra CLIENT-SIDE lo ya cargado (remitente, asunto, vista previa, cliente).
 */
@Component({
  selector: 'app-mail-list',
  imports: [CommonModule, AvatarComponent, LoadMoreComponent, SearchInputComponent, StateBlockComponent],
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
  /** true = la búsqueda la resuelve el servidor (se emite); false = filtra lo cargado. */
  @Input() serverSearch = false;
  @Input() searchPlaceholder = 'Search loaded mail';
  /** Al cambiar (p. ej. de carpeta) se vacía la búsqueda. */
  @Input() set searchResetKey(_key: unknown) {
    this.search.set('');
  }

  @Output() rowSelected = new EventEmitter<string>();
  @Output() retryRequested = new EventEmitter<void>();
  @Output() loadMoreRequested = new EventEmitter<void>();
  @Output() restoreRequested = new EventEmitter<string>();
  @Output() purgeRequested = new EventEmitter<string>();
  @Output() serverSearchChange = new EventEmitter<string>();
  /** B6 — restaurar y borrar para siempre exigen `correspondence.manage`, no `read`. */
  @Input() canManage = true;

  readonly search = signal('');
  /** Espejo del input para que `filteredRows` (computed) reaccione al modo de búsqueda. */
  private readonly serverSearchSig = signal(false);

  @ViewChild('listScroll') private scrollRef?: ElementRef<HTMLElement>;
  @ViewChildren('rowButton') private rowButtons?: QueryList<ElementRef<HTMLElement>>;

  /** Posición/tamaño del pill deslizante que resalta la fila seleccionada. */
  readonly indicatorTop = signal(0);
  readonly indicatorLeft = signal(0);
  readonly indicatorWidth = signal(0);
  readonly indicatorHeight = signal(0);
  readonly indicatorReady = signal(false);

  readonly filteredRows = computed<MailListRow[]>(() => {
    const term = this.search().trim().toLowerCase();
    const rows = this.rowsSig();
    if (!term || this.serverSearchSig()) {
      return rows;
    }
    return rows.filter(row =>
      [row.title, row.subtitle, row.preview, row.tag?.label].some(text => !!text && text.toLowerCase().includes(term)),
    );
  });

  ngAfterViewInit(): void {
    setTimeout(() => this.syncIndicator());
    setTimeout(() => this.syncIndicator(), 300);
    // La lista cambia con la carpeta/búsqueda/paginación: re-medir cuando cambian los botones.
    this.rowButtons?.changes.subscribe(() => setTimeout(() => this.syncIndicator()));
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.serverSearchSig.set(this.serverSearch);
    setTimeout(() => this.syncIndicator());
    // Moverse con j/k puede dejar la fila elegida fuera de la vista: se trae sin saltos bruscos.
    if (changes['selectedId'] && this.selectedId) {
      setTimeout(() => this.scrollSelectedIntoView());
    }
  }

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Atajo `/`: lleva el foco al buscador de la lista. */
  focusSearch(): void {
    this.host.nativeElement.querySelector<HTMLInputElement>('app-search-input input')?.focus();
  }

  private scrollSelectedIntoView(): void {
    const index = this.filteredRows().findIndex(row => row.id === this.selectedId);
    this.rowButtons?.toArray()[index]?.nativeElement.scrollIntoView({ block: 'nearest' });
  }

  /** Lo que un lector de pantalla dice de la fila: remitente, asunto, no leídos, cliente y fecha. */
  rowLabel(row: MailListRow): string {
    return [
      row.title,
      row.subtitle,
      row.unreadCount > 0 ? `${row.unreadCount} unread` : null,
      row.tag?.label ?? null,
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

  onSearchChange(value: string): void {
    this.search.set(value);
    if (this.serverSearch) this.serverSearchChange.emit(value);
    setTimeout(() => this.syncIndicator());
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
