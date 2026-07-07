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

export interface MailMessage {
  id: string;
  folderId: string;
  senderName: string;
  senderInitials: string;
  senderEmail: string;
  avatarColor: string;
  subject: string;
  preview: string;
  body: string;
  time: string;
  isRead: boolean;
  isStarred: boolean;
}

/**
 * Lista de mensajes del módulo Mail (estilo "Aether"): buscador píldora +
 * filas de email (avatar con iniciales, asunto en negrita si no leído,
 * preview truncado, hora relativa, punto negro de no leído y estrella
 * toggleable). Filtra por la carpeta activa (@Input) y por el término de
 * búsqueda (interno). El mensaje seleccionado se resalta con un pill negro
 * que se DESLIZA entre filas al cambiar de selección (mismo patrón que el
 * indicador del sidebar y del rail de carpetas). La carpeta "starred" es
 * virtual: muestra mensajes con estrella sin importar su carpeta real.
 */
@Component({
  selector: 'app-mail-list',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-list.component.html',
  styleUrl: './mail-list.component.css',
})
export class MailListComponent implements OnChanges, AfterViewInit {
  /** Inputs respaldados por signals para que el filtrado sea un computed (se
      recalcula solo cuando cambian los datos, no en cada pasada de CD). */
  private readonly messagesSig = signal<MailMessage[]>([]);
  private readonly activeFolderSig = signal('inbox');

  @Input() set messages(value: MailMessage[]) {
    this.messagesSig.set(value ?? []);
  }

  @Input() set activeFolderId(value: string) {
    this.activeFolderSig.set(value);
  }

  @Input() selectedId: string | null = null;
  @Output() messageSelected = new EventEmitter<string>();
  @Output() starToggled = new EventEmitter<string>();

  readonly search = signal('');

  @ViewChild('listScroll') private scrollRef?: ElementRef<HTMLElement>;
  @ViewChildren('messageButton') private messageButtons?: QueryList<ElementRef<HTMLElement>>;

  /** Posición/tamaño del pill deslizante que resalta el mensaje seleccionado. */
  readonly indicatorTop = signal(0);
  readonly indicatorLeft = signal(0);
  readonly indicatorWidth = signal(0);
  readonly indicatorHeight = signal(0);
  readonly indicatorReady = signal(false);

  readonly filteredMessages = computed<MailMessage[]>(() => {
    const term = this.search().trim().toLowerCase();
    const folder = this.activeFolderSig();
    return this.messagesSig().filter(message => {
      const inFolder = folder === 'starred' ? message.isStarred : message.folderId === folder;
      if (!inFolder) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        message.subject.toLowerCase().includes(term) ||
        message.preview.toLowerCase().includes(term) ||
        message.senderName.toLowerCase().includes(term)
      );
    });
  });

  ngAfterViewInit(): void {
    setTimeout(() => this.syncIndicator());
    setTimeout(() => this.syncIndicator(), 300);
    // La lista cambia con la carpeta/búsqueda: re-medir cuando cambian los botones.
    this.messageButtons?.changes.subscribe(() => setTimeout(() => this.syncIndicator()));
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
    this.messageSelected.emit(id);
  }

  trackByMessageId(_index: number, message: MailMessage): string {
    return message.id;
  }

  toggleStar(id: string, event: Event): void {
    event.stopPropagation();
    this.starToggled.emit(id);
  }

  private syncIndicator(): void {
    const container = this.scrollRef?.nativeElement;
    const buttons = this.messageButtons?.toArray();
    if (!container || !buttons?.length || this.selectedId === null) {
      this.indicatorReady.set(false);
      return;
    }

    const activeIndex = this.filteredMessages().findIndex(message => message.id === this.selectedId);
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
