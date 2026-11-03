import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, of, timer } from 'rxjs';
import { catchError, debounce, map, switchMap } from 'rxjs/operators';
import { ClickOutsideDirective } from '../../directives/click-outside.directive';
import { AvatarComponent } from '../avatar/avatar.component';
import { InfinityLoaderComponent } from '../infinity-loader/infinity-loader.component';
import {
  GroupedSearchChip,
  GroupedSearchEntry,
  GroupedSearchGroup,
  GroupedSearchItem,
  GroupedSearchPick,
  GroupedSearchSuggestions,
  HighlightPart,
  flattenEntries,
  highlightParts,
  moveHighlight,
  visibleGroups,
} from './grouped-search.model';

let groupedSearchSeq = 0;

/**
 * Buscador con sugerencias AGRUPADAS (estilo Outlook): input + desplegable por grupos + chips quitables.
 * No guarda estado de ninguna feature: el llamador da la función de búsqueda y reacciona a los eventos.
 *
 * Uso:
 * ```html
 * <app-grouped-search [search]="suggestFn" [value]="q()" [chips]="chips()" placeholder="Search mail…"
 *   (picked)="onPick($event)" (submitted)="onSearch($event)" (chipRemoved)="onChip($event)" (cleared)="onClear()" />
 * ```
 * `search = (term) => Observable<GroupedSearchSuggestions>`: puede emitir varias veces (un grupo llega
 * antes que otro, `pending` mientras falte alguno). Definirla como propiedad flecha.
 *
 * - Teclear (≥ `minChars`, con `debounceMs`) abre el desplegable; `switchMap` descarta respuestas viejas.
 * - Con el texto vacío muestra `idleGroups` (p. ej. clientes recientes), si hay.
 * - Teclado: ↑/↓ recorren sugerencias y el pie "See all results"; Enter elige la resaltada o, sin ninguna,
 *   emite `(submitted)` con lo tecleado; Esc cierra (y con el panel cerrado limpia); Backspace con el input
 *   vacío quita el último chip.
 * - La coincidencia se resalta en etiqueta y subtítulo (sin innerHTML).
 * - Pantallas chicas (< lg): al abrirse ocupa toda la pantalla, con botón para volver.
 * - Cierra al pulsar fuera (`appClickOutside`).
 */
@Component({
  selector: 'app-grouped-search',
  imports: [ClickOutsideDirective, AvatarComponent, InfinityLoaderComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'block' },
  styles: `
    @media (max-width: 1023.98px) {
      .gs-overlay {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        background: #fff;
        padding: 1rem;
      }
      .gs-overlay .gs-panel {
        position: static;
        flex: 1 1 auto;
        max-height: none;
        border: 0;
        box-shadow: none;
      }
    }
  `,
  template: `
    <div class="relative" [class.gs-overlay]="panelVisible()" appClickOutside [clickOutsideEnabled]="open()"
      (appClickOutside)="close()">
      <div class="flex items-center gap-2">
        @if (panelVisible()) {
          <button type="button" (click)="close()" aria-label="Close search"
            class="grid h-10 w-10 shrink-0 place-items-center rounded-full text-gray-500 hover:bg-gray-100 lg:hidden">
            <ion-icon name="arrow-back-outline" class="text-lg"></ion-icon>
          </button>
        }
        <div class="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-1 focus-within:border-gray-300 transition-colors">
          <ion-icon name="search-outline" class="shrink-0 text-base text-gray-400"></ion-icon>
          @for (chip of chips; track chip.id) {
            <span class="flex max-w-[12rem] items-center gap-1 rounded-full bg-brand-bold/10 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-brand-bold">
              <span class="truncate">{{ chip.label }}</span>
              <button type="button" (click)="removeChip(chip.id)" [attr.aria-label]="'Remove ' + chip.label"
                class="grid h-4 w-4 shrink-0 place-items-center rounded-full hover:bg-brand-bold/15">
                <ion-icon name="close-outline" class="text-xs"></ion-icon>
              </button>
            </span>
          }
          <input #input type="text" autocomplete="off" role="combobox" aria-autocomplete="list"
            [attr.aria-label]="ariaLabel || placeholder" [attr.aria-expanded]="panelVisible()" [attr.aria-controls]="listId"
            [attr.aria-activedescendant]="panelVisible() && highlighted() >= 0 ? listId + '-' + highlighted() : null"
            [placeholder]="chips.length ? '' : placeholder" [value]="text()"
            (input)="onInput($any($event.target).value)" (focus)="onFocus()" (click)="onFocus()" (keydown)="onKeydown($event)"
            class="h-8 flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none" />
          @if (text() || value) {
            <button type="button" (click)="clear()" aria-label="Clear search"
              class="grid h-5 w-5 shrink-0 place-items-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
              <ion-icon name="close-outline" class="text-sm"></ion-icon>
            </button>
          }
        </div>
      </div>

      @if (panelVisible()) {
        <div [id]="listId" role="listbox" [attr.aria-label]="ariaLabel || placeholder"
          class="gs-panel absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-gray-100 bg-white py-1 shadow-lg">
          @for (group of shownGroups(); track group.id) {
            <p class="px-3 pb-1 pt-2 text-[0.625rem] font-semibold uppercase tracking-wide text-gray-400">{{ group.label }}</p>
            @for (item of group.items; track item.id) {
              @let index = indexOf(group.id, item);
              <button type="button" role="option" [id]="listId + '-' + index" [attr.aria-selected]="index === highlighted()"
                (mousedown)="$event.preventDefault()" (mouseenter)="highlighted.set(index)" (click)="pick(group.id, item)"
                class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors"
                [class.bg-gray-50]="index === highlighted()">
                @if (item.avatar; as avatar) {
                  <app-avatar [name]="avatar.name" [seed]="avatar.seed ?? null" [imageUrl]="avatar.imageUrl ?? null" size="sm" />
                } @else {
                  <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-500">
                    <ion-icon [name]="item.icon || 'search-outline'" class="text-sm"></ion-icon>
                  </span>
                }
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm text-gray-800">
                    @for (part of parts(item.label); track $index) {
                      @if (part.match) {<mark class="bg-transparent font-semibold text-gray-900">{{ part.text }}</mark>} @else {<span>{{ part.text }}</span>}
                    }
                  </span>
                  @if (item.sublabel) {
                    <span class="block truncate text-[0.6875rem] text-gray-400">
                      @for (part of parts(item.sublabel); track $index) {
                        @if (part.match) {<mark class="bg-transparent font-semibold text-gray-700">{{ part.text }}</mark>} @else {<span>{{ part.text }}</span>}
                      }
                    </span>
                  }
                </span>
                @if (item.meta) {
                  <span class="shrink-0 text-[0.6875rem] text-gray-400">{{ item.meta }}</span>
                }
              </button>
            }
          }

          @if (searching()) {
            <div class="flex items-center gap-2 px-3 py-2 text-xs text-gray-400">
              <app-infinity-loader size="xs" /> Searching…
            </div>
          } @else if (showEmpty()) {
            <p class="px-3 py-3 text-sm text-gray-500">{{ emptyText }} "{{ term() }}"</p>
          }

          @if (hasTerm()) {
            @let allIndex = entries().length - 1;
            <button type="button" role="option" [id]="listId + '-' + allIndex" [attr.aria-selected]="allIndex === highlighted()"
              (mousedown)="$event.preventDefault()" (mouseenter)="highlighted.set(allIndex)" (click)="submit()"
              class="mt-1 flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2.5 text-left text-sm font-medium text-brand-bold transition-colors"
              [class.bg-gray-50]="allIndex === highlighted()">
              <ion-icon name="search-outline" class="text-base"></ion-icon>
              <span class="min-w-0 flex-1 truncate">{{ seeAllLabel }} "{{ term() }}"</span>
              <kbd class="hidden rounded-md border border-gray-200 px-1.5 py-0.5 font-mono text-[0.625rem] text-gray-400 lg:inline">Enter</kbd>
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class GroupedSearchComponent<T = unknown> implements OnChanges {
  @Input({ required: true }) search!: (term: string) => Observable<GroupedSearchSuggestions<T>>;
  /** Texto confirmado por el llamador (p. ej. `q` de la URL): se muestra en el input. */
  @Input() value = '';
  @Input() placeholder = 'Search…';
  @Input() ariaLabel = '';
  @Input() minChars = 2;
  @Input() debounceMs = 250;
  @Input() maxPerGroup = 5;
  @Input() chips: readonly GroupedSearchChip[] = [];
  /** Grupos con el texto vacío (p. ej. clientes recientes). */
  @Input() set idleGroups(value: readonly GroupedSearchGroup<T>[] | null | undefined) {
    this.idle.set(value ?? []);
  }
  @Input() emptyText = 'No matches for';
  @Input() seeAllLabel = 'See all results for';

  @Output() readonly picked = new EventEmitter<GroupedSearchPick<T>>();
  @Output() readonly submitted = new EventEmitter<string>();
  @Output() readonly chipRemoved = new EventEmitter<string>();
  @Output() readonly cleared = new EventEmitter<void>();

  @ViewChild('input') private inputRef?: ElementRef<HTMLInputElement>;

  readonly listId = `grouped-search-${groupedSearchSeq++}`;

  readonly text = signal('');
  readonly open = signal(false);
  readonly highlighted = signal(-1);
  private readonly results = signal<readonly GroupedSearchGroup<T>[]>([]);
  readonly searching = signal(false);
  /** Término cuyos resultados están pintados (null = aún nada). */
  private readonly searchedTerm = signal<string | null>(null);
  private readonly idle = signal<readonly GroupedSearchGroup<T>[]>([]);
  private readonly minCharsSig = signal(2);
  private readonly maxSig = signal(5);

  private readonly terms$ = new Subject<string>();

  readonly term = computed(() => this.text().trim());
  readonly hasTerm = computed(() => this.term().length >= this.minCharsSig());

  readonly shownGroups = computed<GroupedSearchGroup<T>[]>(() => {
    if (this.hasTerm()) {
      return this.searchedTerm() === null ? [] : visibleGroups(this.results(), this.maxSig());
    }
    return this.term().length === 0 ? visibleGroups(this.idle(), this.maxSig()) : [];
  });

  readonly entries = computed<GroupedSearchEntry<T>[]>(() => flattenEntries(this.shownGroups(), this.hasTerm()));

  readonly showEmpty = computed(
    () => this.hasTerm() && !this.searching() && this.searchedTerm() !== null && this.shownGroups().length === 0,
  );

  readonly panelVisible = computed(() => this.open() && (this.hasTerm() || this.shownGroups().length > 0));

  constructor() {
    this.terms$
      .pipe(
        debounce(() => timer(Math.max(0, this.debounceMs))),
        switchMap(term => {
          if (term.length < this.minCharsSig()) {
            this.searching.set(false);
            return of({ term: null as string | null, value: { groups: [], pending: false } as GroupedSearchSuggestions<T> });
          }
          this.searching.set(true);
          return this.search(term).pipe(
            catchError(() => of<GroupedSearchSuggestions<T>>({ groups: [], pending: false })),
            // Cada emisión (un grupo que llega) se pinta; `pending` mantiene el "Searching…".
            map(value => ({ term: term as string | null, value })),
          );
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(({ term, value }) => {
        this.results.set(value.groups);
        this.searchedTerm.set(term);
        this.searching.set(term !== null && value.pending);
        if (this.highlighted() >= this.entries().length) {
          this.highlighted.set(-1);
        }
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value']) {
      this.text.set(this.value ?? '');
    }
    if (changes['minChars']) {
      this.minCharsSig.set(Math.max(1, this.minChars || 1));
    }
    if (changes['maxPerGroup']) {
      this.maxSig.set(Math.max(1, this.maxPerGroup || 1));
    }
  }

  /** Lleva el foco al input (atajo `/` del llamador). */
  focus(): void {
    this.inputRef?.nativeElement.focus();
    this.inputRef?.nativeElement.select();
  }

  parts(text: string | null | undefined): HighlightPart[] {
    return highlightParts(text, this.term());
  }

  /** Índice plano de una sugerencia (para el resaltado y aria-activedescendant). */
  indexOf(groupId: string, item: GroupedSearchItem<T>): number {
    return this.entries().findIndex(entry => entry.kind === 'item' && entry.groupId === groupId && entry.item === item);
  }

  onFocus(): void {
    if (this.open()) {
      return;
    }
    this.open.set(true);
    this.highlighted.set(-1);
    if (this.hasTerm() && this.searchedTerm() !== this.term()) {
      this.terms$.next(this.term());
    }
  }

  onInput(value: string): void {
    this.text.set(value);
    this.open.set(true);
    this.highlighted.set(-1);
    const term = value.trim();
    if (term.length < this.minCharsSig()) {
      this.results.set([]);
      this.searchedTerm.set(null);
      this.searching.set(false);
    }
    this.terms$.next(term);
  }

  onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.open()) {
          this.onFocus();
          return;
        }
        this.highlighted.set(moveHighlight(this.highlighted(), event.key === 'ArrowDown' ? 1 : -1, this.entries().length));
        break;
      }
      case 'Enter': {
        event.preventDefault();
        const entry = this.entries()[this.highlighted()];
        if (entry?.kind === 'item') {
          this.pick(entry.groupId, entry.item);
        } else {
          this.submit();
        }
        break;
      }
      case 'Escape':
        event.stopPropagation(); // no cerrar también un modal que lo contenga
        if (this.open()) {
          this.close();
        } else if (this.text() || this.value) {
          this.clear();
        }
        break;
      case 'Backspace':
        if (!this.text() && this.chips.length > 0) {
          this.removeChip(this.chips[this.chips.length - 1].id);
        }
        break;
    }
  }

  pick(groupId: string, item: GroupedSearchItem<T>): void {
    this.picked.emit({ groupId, item });
    // Elegir una sugerencia no confirma lo tecleado: vuelve al texto confirmado.
    this.text.set(this.value ?? '');
    this.resetResults();
    this.close();
  }

  /** Enter o "See all results": confirma lo tecleado (vacío = el llamador decide, p. ej. salir de la búsqueda). */
  submit(): void {
    this.submitted.emit(this.term());
    this.close();
  }

  clear(): void {
    this.text.set('');
    this.resetResults();
    this.close();
    this.cleared.emit();
  }

  removeChip(id: string): void {
    this.chipRemoved.emit(id);
  }

  close(): void {
    this.open.set(false);
    this.highlighted.set(-1);
  }

  private resetResults(): void {
    this.results.set([]);
    this.searchedTerm.set(null);
    this.searching.set(false);
  }
}
