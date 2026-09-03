import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  Input,
  Output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';

/** Una opción del catálogo, normalizada para el picker (label visible + hint opcional). */
export interface CatalogOption {
  id: string;
  label: string;
  hint?: string | null;
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Picker de catálogo reutilizable (typeahead): botón que muestra la selección actual y un dropdown
 * con búsqueda server-side + resultados. Usado para ocupación (individuo) y actividad NAICS (empresa),
 * cuyos catálogos son curados (el backend guarda el id, no texto libre). Mismo patrón visual que el
 * picker de cliente del panel de tareas. El componente es presentacional: recibe una función de
 * búsqueda que devuelve un Observable y emite la opción elegida (o null al limpiar).
 */
@Component({
  selector: 'app-catalog-picker',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './catalog-picker.component.html',
})
export class CatalogPickerComponent {
  @Input() label = '';
  @Input() placeholder = 'Search…';
  /** Nombre de la opción seleccionada (lo controla el padre); null = sin selección. */
  @Input() selectedName: string | null = null;
  /** Función de búsqueda: `q` vacío devuelve el catálogo inicial. */
  @Input({ required: true }) search!: (q: string) => Observable<CatalogOption[]>;
  /** Id único para el `data-dropdown` (cerrar al hacer click fuera) cuando hay 2 pickers en el form. */
  @Input() scope = 'catalog-picker';

  @Output() picked = new EventEmitter<CatalogOption | null>();

  readonly query = signal('');
  readonly results = signal<CatalogOption[]>([]);
  readonly open = signal(false);
  readonly searching = signal(false);

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest(`[data-dropdown="${this.scope}"]`)) {
      this.open.set(false);
    }
  }

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next && this.results().length === 0) {
      this.runSearch('');
    }
  }

  onSearch(term: string): void {
    this.query.set(term);
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.runSearch(term);
    }, SEARCH_DEBOUNCE_MS);
  }

  choose(option: CatalogOption): void {
    this.picked.emit(option);
    this.open.set(false);
    this.query.set('');
    this.results.set([]);
  }

  clear(event: Event): void {
    event.stopPropagation();
    this.picked.emit(null);
    this.query.set('');
    this.results.set([]);
    this.open.set(false);
  }

  private runSearch(term: string): void {
    this.searching.set(true);
    this.search(term).subscribe({
      next: results => {
        this.results.set(results);
        this.searching.set(false);
      },
      error: () => {
        this.results.set([]);
        this.searching.set(false);
      },
    });
  }
}
