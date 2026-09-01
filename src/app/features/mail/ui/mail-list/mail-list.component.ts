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
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * Fila del listado central, ya aplanada por mail-page desde `ThreadSummary`
 * (carpetas Conversations/Archived) o `DraftListItem` (carpeta Drafts).
 */
export interface MailListRow {
  /** threadId o draftId, según la carpeta activa. */
  id: string;
  initials: string;
  avatarColor: string;
  /** Asunto real del hilo/draft. */
  title: string;
  /** Segunda línea: conteo de mensajes del hilo o tipo de draft. */
  subtitle: string;
  /** Fecha formateada (última actividad del hilo / última edición del draft). */
  time: string;
  /** Chip opcional: "Archived", o el estado del draft cuando no es `Draft`. */
  badge: string | null;
  /** Correos inbound no leídos del hilo (0 en drafts). Pinta el hilo en negrita + globo. */
  unreadCount: number;
}

/**
 * Listado central del módulo Mail (estilo "Aether"): buscador píldora + filas
 * con avatar de iniciales, asunto, meta y fecha. La fila seleccionada se
 * resalta con un pill negro que se DESLIZA entre filas (mismo patrón que el
 * indicador del sidebar y del rail de carpetas).
 *
 * Sigue siendo dumb: recibe filas ya armadas más los estados de carga del store
 * y emite selección / retry / paginación. La búsqueda es CLIENT-SIDE sobre lo
 * ya cargado porque ni `GET /correspondence/customers/{id}/threads` ni
 * `GET /correspondence/drafts` aceptan un parámetro de término.
 */
@Component({
  selector: 'app-mail-list',
  imports: [CommonModule, FormsModule],
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

  @Output() rowSelected = new EventEmitter<string>();
  @Output() retryRequested = new EventEmitter<void>();
  @Output() loadMoreRequested = new EventEmitter<void>();

  readonly search = signal('');

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
    if (!term) {
      return rows;
    }
    return rows.filter(
      row => row.title.toLowerCase().includes(term) || row.subtitle.toLowerCase().includes(term),
    );
  });

  ngAfterViewInit(): void {
    setTimeout(() => this.syncIndicator());
    setTimeout(() => this.syncIndicator(), 300);
    // La lista cambia con la carpeta/búsqueda/paginación: re-medir cuando cambian los botones.
    this.rowButtons?.changes.subscribe(() => setTimeout(() => this.syncIndicator()));
  }

  ngOnChanges(): void {
    setTimeout(() => this.syncIndicator());
  }

  @HostListener('window:resize')
  onResize(): void {
    this.syncIndicator();
  }

  onSearchChange(value: string): void {
    this.search.set(value);
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
