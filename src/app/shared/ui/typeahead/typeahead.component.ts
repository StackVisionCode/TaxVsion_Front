import {
  Component,
  ContentChild,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  TemplateRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, of, timer } from 'rxjs';
import { catchError, debounce, map, switchMap, tap } from 'rxjs/operators';
import { ClickOutsideDirective } from '../../directives/click-outside.directive';

/** Contexto del `ng-template #option`: `let-item` (= `$implicit`), `let-i="index"`, `let-active="active"`. */
export interface TypeaheadOptionContext<T> {
  $implicit: T;
  index: number;
  active: boolean;
}

let typeaheadSeq = 0;

/**
 * Typeahead genérico (combobox con búsqueda server-side). Promovido desde
 * `features/clients/ui/catalog-picker` y el picker de cliente de mail (↑/↓/Enter/Esc + recientes).
 *
 * Uso:
 * ```html
 * <app-typeahead [search]="searchFn" placeholder="Search a client…" [recent]="recents()"
 *   [displayWith]="nameOf" (picked)="onPick($event)">
 *   <ng-template #option let-item let-active="active">…fila personalizada…</ng-template>
 * </app-typeahead>
 * ```
 * `searchFn = (q: string) => Observable<T[]>` — definirla como propiedad flecha para conservar `this`.
 *
 * Inputs: `search` (requerido), `placeholder` ('Search…'), `minChars` (0), `debounceMs` (250),
 * `recent` (T[] mostrados con la búsqueda vacía bajo "Recent"), `displayWith` (texto por defecto de la
 * opción), `trackBy` (identidad de la opción; default el propio item), `disabled`, `emptyText`
 * ('No results'), `ariaLabel`, `inputClass` (clases extra del input).
 * Outputs: `(picked)` T elegido, `(queryChange)` texto tecleado.
 *
 * Comportamiento:
 * - Al enfocar con la búsqueda vacía: muestra `recent` si hay; si no y `minChars === 0`, busca '' (browse).
 * - Teclear dispara `search` con debounce; `switchMap` descarta respuestas viejas. Un error → lista vacía.
 * - Estados "Searching…" y `emptyText`. Si `minChars > 0` y el texto es más corto: "Type at least N characters".
 * - Teclado: ArrowDown/ArrowUp (cíclico), Enter elige el resaltado, Escape cierra.
 * - Cierra al pulsar fuera (`appClickOutside`). Tras elegir, limpia el texto y cierra.
 *
 * Normalizado: catalog-picker era un botón que abría un popover con un input dentro; aquí el input es
 * el disparador (como invoice-form/mail), con el look del input de invoice-form (`h-11 rounded-full`).
 * El cierre por blur con `setTimeout(150)` de mail/invoice se sustituye por `mousedown.preventDefault`
 * en las opciones + click-outside.
 */
@Component({
  selector: 'app-typeahead',
  imports: [NgClass, NgTemplateOutlet, ClickOutsideDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'block' },
  template: `
    <div class="relative" appClickOutside [clickOutsideEnabled]="open()" (appClickOutside)="close()">
      <ion-icon name="search-outline"
        class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base text-gray-400"></ion-icon>
      <input #input type="text" autocomplete="off" role="combobox" aria-autocomplete="list"
        [attr.aria-label]="ariaLabel || placeholder" [attr.aria-expanded]="panelVisible()" [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="panelVisible() && items().length ? listId + '-' + highlighted() : null"
        [placeholder]="placeholder" [disabled]="disabled" [value]="query()"
        (input)="onInput($any($event.target).value)" (focus)="onFocus()" (click)="onFocus()" (keydown)="onKeydown($event)"
        class="h-11 w-full rounded-full border border-gray-200 bg-white pl-11 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:border-gray-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
        [ngClass]="inputClass" />

      @if (panelVisible()) {
        <div [id]="listId" role="listbox"
          class="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-gray-100 bg-white py-1 shadow-lg">
          @if (searching()) {
            <div class="flex items-center gap-2 px-3 py-2 text-xs text-gray-400">
              <ion-icon name="sync-outline" class="animate-spin text-sm"></ion-icon> Searching…
            </div>
          }
          @if (showingRecents()) {
            <p class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{{ recentLabel }}</p>
          }
          @for (item of items(); track trackBy(item); let i = $index) {
            <button type="button" role="option" [id]="listId + '-' + i" [attr.aria-selected]="i === highlighted()"
              (mousedown)="$event.preventDefault()" (mouseenter)="highlighted.set(i)" (click)="pick(item)"
              class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors"
              [class.bg-gray-50]="i === highlighted()">
              @if (optionTpl) {
                <ng-container
                  *ngTemplateOutlet="optionTpl; context: { $implicit: item, index: i, active: i === highlighted() }"></ng-container>
              } @else {
                <span class="min-w-0 flex-1 truncate text-gray-700">{{ displayWith(item) }}</span>
              }
            </button>
          }
          @if (belowMinChars()) {
            <p class="px-3 py-3 text-sm text-gray-400">Type at least {{ minChars }} characters</p>
          } @else if (showNoResults()) {
            <p class="px-3 py-3 text-sm text-gray-400">{{ emptyText }}</p>
          }
        </div>
      }
    </div>
  `,
})
export class TypeaheadComponent<T> {
  @Input({ required: true }) search!: (q: string) => Observable<T[]>;
  @Input() placeholder = 'Search…';
  @Input() set minChars(value: number) {
    this.minCharsSig.set(Math.max(0, value || 0));
  }
  get minChars(): number {
    return this.minCharsSig();
  }
  @Input() debounceMs = 250;
  @Input() set recent(value: readonly T[] | null | undefined) {
    this.recentItems.set(value ?? []);
  }
  @Input() recentLabel = 'Recent';
  @Input() displayWith: (item: T) => string = item => String(item ?? '');
  @Input() trackBy: (item: T) => unknown = item => item;
  @Input() set disabled(value: boolean) {
    this.disabledSig.set(!!value);
    if (value) {
      this.open.set(false);
    }
  }
  get disabled(): boolean {
    return this.disabledSig();
  }
  @Input() emptyText = 'No results';
  @Input() ariaLabel = '';
  @Input() inputClass = '';

  @Output() readonly picked = new EventEmitter<T>();
  @Output() readonly queryChange = new EventEmitter<string>();

  @ContentChild('option', { read: TemplateRef }) optionTpl?: TemplateRef<TypeaheadOptionContext<T>>;
  @ViewChild('input') private inputRef?: ElementRef<HTMLInputElement>;

  readonly listId = `typeahead-${typeaheadSeq++}`;

  readonly query = signal('');
  readonly open = signal(false);
  readonly results = signal<T[]>([]);
  readonly searching = signal(false);
  readonly highlighted = signal(0);
  /** Término cuyos resultados están pintados (null = aún no se buscó nada). */
  private readonly searchedTerm = signal<string | null>(null);
  private readonly recentItems = signal<readonly T[]>([]);
  /** Respaldo en signal de `minChars`/`disabled` para que los computed los lean. */
  private readonly minCharsSig = signal(0);
  private readonly disabledSig = signal(false);

  private readonly terms$ = new Subject<{ term: string; immediate: boolean }>();

  readonly showingRecents = computed(() => this.query().trim() === '' && this.recentItems().length > 0);

  readonly belowMinChars = computed(() => {
    const term = this.query().trim();
    return term.length > 0 && term.length < this.minCharsSig();
  });

  /** Lista plana que se pinta y sobre la que navegan las flechas. */
  readonly items = computed<readonly T[]>(() => {
    if (this.showingRecents()) {
      return this.recentItems();
    }
    return this.belowMinChars() ? [] : this.results();
  });

  readonly showNoResults = computed(
    () => !this.searching() && !this.showingRecents() && this.items().length === 0 && this.searchedTerm() !== null,
  );

  readonly panelVisible = computed(
    () =>
      this.open() &&
      !this.disabledSig() &&
      (this.searching() || this.items().length > 0 || this.belowMinChars() || this.showNoResults()),
  );

  constructor() {
    this.terms$
      .pipe(
        debounce(({ immediate }) => timer(immediate ? 0 : Math.max(0, this.debounceMs))),
        switchMap(({ term }) => {
          if (term.length < this.minChars) {
            this.searching.set(false);
            return of({ term: null as string | null, items: [] as T[] });
          }
          this.searching.set(true);
          return this.search(term).pipe(
            map(items => ({ term: term as string | null, items: items ?? [] })),
            catchError(() => of({ term: term as string | null, items: [] as T[] })),
          );
        }),
        tap(({ term, items }) => {
          this.results.set(items);
          this.searchedTerm.set(term);
          this.searching.set(false);
          this.highlighted.set(0);
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe();
  }

  /** Enfoca el input (p. ej. al abrir un panel que contiene el typeahead). */
  focus(): void {
    this.inputRef?.nativeElement.focus();
  }

  onFocus(): void {
    if (this.disabled || this.open()) {
      return;
    }
    this.open.set(true);
    this.highlighted.set(0);
    const term = this.query().trim();
    // Búsqueda vacía sin recientes: "browse" (solo si minChars lo permite y aún no hay resultados).
    if (term === '' && this.recentItems().length === 0 && this.minChars === 0 && this.searchedTerm() === null) {
      this.request('', true);
    }
  }

  onInput(value: string): void {
    this.query.set(value);
    this.queryChange.emit(value);
    this.open.set(true);
    this.highlighted.set(0);
    const term = value.trim();
    if (term === '' && this.recentItems().length > 0) {
      return; // se ven los recientes; no hace falta ir a la red
    }
    this.request(term, false);
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
        const count = this.items().length;
        if (count > 0) {
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          this.highlighted.set((this.highlighted() + delta + count) % count);
        }
        break;
      }
      case 'Enter': {
        if (!this.panelVisible()) {
          return;
        }
        event.preventDefault();
        const item = this.items()[this.highlighted()];
        if (item !== undefined) {
          this.pick(item);
        }
        break;
      }
      case 'Escape':
        if (this.open()) {
          event.stopPropagation(); // no cerrar también el modal que lo contiene
          this.close();
        }
        break;
    }
  }

  pick(item: T): void {
    this.picked.emit(item);
    this.reset();
  }

  close(): void {
    this.open.set(false);
  }

  /** Limpia texto y resultados y cierra. */
  reset(): void {
    this.query.set('');
    this.results.set([]);
    this.searchedTerm.set(null);
    this.searching.set(false);
    this.open.set(false);
    this.highlighted.set(0);
  }

  private request(term: string, immediate: boolean): void {
    this.terms$.next({ term, immediate });
  }
}
