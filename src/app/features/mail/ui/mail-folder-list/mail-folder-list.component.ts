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
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface MailFolder {
  id: string;
  label: string;
  icon: string;
  unreadCount: number;
}

/**
 * Rail de carpetas del módulo Mail (estilo "Aether"): botón negro "Compose"
 * arriba, seguido de filas píldora por carpeta (Inbox, Sent, Drafts, Starred,
 * Archive, Trash). La carpeta activa se resalta con un pill negro que se
 * DESLIZA entre carpetas al cambiar de selección (mismo patrón que el
 * indicador del sidebar): un div posicionado en absoluto que se mide contra
 * el botón activo y transiciona su posición/tamaño. Es puramente
 * presentacional — el conteo y la selección viven en el padre (mail-page).
 */
@Component({
  selector: 'app-mail-folder-list',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './mail-folder-list.component.html',
  styleUrl: './mail-folder-list.component.css',
})
export class MailFolderListComponent implements OnChanges, AfterViewInit {
  @Input() folders: MailFolder[] = [];
  @Input() activeFolderId = 'inbox';
  @Output() folderSelected = new EventEmitter<string>();
  @Output() composeClicked = new EventEmitter<void>();

  @ViewChild('folderNav') private navRef?: ElementRef<HTMLElement>;
  @ViewChildren('folderButton') private folderButtons?: QueryList<ElementRef<HTMLElement>>;

  /** Posición/tamaño del pill deslizante que resalta la carpeta activa. */
  readonly indicatorTop = signal(0);
  readonly indicatorLeft = signal(0);
  readonly indicatorWidth = signal(0);
  readonly indicatorHeight = signal(0);
  readonly indicatorReady = signal(false);

  ngAfterViewInit(): void {
    setTimeout(() => this.syncIndicator());
    // Los <ion-icon> cargan del CDN y pueden reajustar el layout después de la
    // primera medición; re-medir una vez más apenas se asiente evita que el
    // pill arranque desalineado hasta la primera interacción.
    setTimeout(() => this.syncIndicator(), 300);
    this.folderButtons?.changes.subscribe(() => this.syncIndicator());
  }

  ngOnChanges(): void {
    // La selección puede cambiar desde el padre; re-medir tras el render.
    setTimeout(() => this.syncIndicator());
  }

  @HostListener('window:resize')
  onResize(): void {
    this.syncIndicator();
  }

  select(id: string): void {
    this.folderSelected.emit(id);
  }

  /**
   * El padre recalcula `folders` como un `computed()` que crea objetos nuevos
   * en cada actualización (ej. al marcar un correo como leído), aunque el id
   * no cambie. Sin trackBy, Angular destruiría y recrearía TODOS los botones
   * en cada selección de mensaje — se veía como si la página recargara.
   */
  trackByFolderId(_index: number, folder: MailFolder): string {
    return folder.id;
  }

  compose(): void {
    this.composeClicked.emit();
  }

  private syncIndicator(): void {
    const container = this.navRef?.nativeElement;
    const buttons = this.folderButtons?.toArray();
    if (!container || !buttons?.length) {
      this.indicatorReady.set(false);
      return;
    }

    const activeIndex = this.folders.findIndex(folder => folder.id === this.activeFolderId);
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
