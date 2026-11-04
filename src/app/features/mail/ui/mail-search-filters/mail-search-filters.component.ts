import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ClickOutsideDirective } from '@shared/directives/click-outside.directive';
import { captureActiveElement, portalToBody, trapTabKey } from '@shared/utils/overlay.util';
import { MailDatePreset, isValidDay } from '../../utils/mail-search-dates';
import { MailOperatorFolder } from '../../utils/mail-search-operators';

/** Lo que edita el panel de búsqueda avanzada (Keywords = `q`). */
export interface MailAdvancedSearch {
  q: string;
  from: string;
  to: string;
  subject: string;
  folder: MailOperatorFolder | null;
  date: MailDatePreset;
  dateFrom: string | null;
  dateTo: string | null;
  hasAttachments: boolean;
  unread: boolean;
}

export const EMPTY_ADVANCED_SEARCH: Readonly<MailAdvancedSearch> = {
  q: '',
  from: '',
  to: '',
  subject: '',
  folder: null,
  date: 'any',
  dateFrom: null,
  dateTo: null,
  hasAttachments: false,
  unread: false,
};

type TextField = 'q' | 'from' | 'to' | 'subject';

/** Errores del formulario (por campo y general). Vacío = válido. Pura para probarla aislada. */
export function validateAdvancedSearch(value: MailAdvancedSearch): Partial<Record<TextField | 'date' | 'form', string>> {
  const errors: Partial<Record<TextField | 'date' | 'form', string>> = {};
  for (const key of ['q', 'from', 'to', 'subject'] as const) {
    const text = value[key].trim();
    if (text && text.length < 2) errors[key] = 'Enter at least 2 characters.';
    if (text.length > 200) errors[key] = 'Use 200 characters or fewer.';
  }
  if (!['q', 'from', 'to', 'subject'].some(key => value[key as TextField].trim())) {
    errors.form = 'Add keywords, a sender, a recipient or a subject to search.';
  }
  if (value.date === 'custom') {
    if (!isValidDay(value.dateFrom) && !isValidDay(value.dateTo)) {
      errors.date = 'Pick a start or end date.';
    } else if (isValidDay(value.dateFrom) && isValidDay(value.dateTo) && value.dateFrom! > value.dateTo!) {
      errors.date = 'The start date must be before the end date.';
    }
  }
  return errors;
}

let panelSeq = 0;

/**
 * Panel de búsqueda avanzada de Mail (ícono de filtros del buscador): From, To, Subject, Keywords, Folder,
 * fechas (presets + personalizado), Has attachments y Unread. Se porta al `<body>` (`fixed`) bajo el
 * buscador para que ninguna tarjeta lo recorte; en pantallas chicas ocupa toda la pantalla. Foco en el
 * primer campo al abrir, Tab no se escapa, Esc o pulsar fuera cierran y el foco vuelve al disparador.
 */
@Component({
  selector: 'app-mail-search-filters',
  imports: [ClickOutsideDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (open) {
      <div #panel role="dialog" aria-modal="true" [attr.aria-labelledby]="ids + '-title'"
        appClickOutside [clickOutsideIgnore]="ignore" (appClickOutside)="close()" (keydown)="onKeydown($event)"
        class="fixed z-[70] flex flex-col bg-white"
        [class]="sheet() ? 'inset-0' : 'rounded-2xl border border-gray-100 shadow-xl'"
        [style.top.px]="sheet() ? null : (position()?.top ?? 0)" [style.left.px]="sheet() ? null : (position()?.left ?? 0)"
        [style.width.px]="sheet() ? null : (position()?.width ?? null)"
        [style.max-height.px]="sheet() ? null : (position()?.maxHeight ?? null)"
        [style.visibility]="sheet() || position() ? 'visible' : 'hidden'">
        <div class="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
          <h2 [id]="ids + '-title'" class="text-sm font-semibold text-gray-900">Search filters</h2>
          <button type="button" (click)="close()" aria-label="Close search filters"
            class="grid h-8 w-8 place-items-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
            <ion-icon name="close-outline" class="text-lg"></ion-icon>
          </button>
        </div>

        <form class="flex min-h-0 flex-1 flex-col" (submit)="$event.preventDefault(); submit()" novalidate>
          <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            @for (field of textFields; track field.key) {
              <div>
                <label [for]="ids + '-' + field.key" class="block text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-400">{{ field.label }}</label>
                <input [id]="ids + '-' + field.key" type="text" autocomplete="off" [placeholder]="field.placeholder"
                  [value]="form()[field.key]" (input)="patch(field.key, $any($event.target).value)"
                  [attr.aria-invalid]="!!shownErrors()[field.key]" [attr.aria-describedby]="shownErrors()[field.key] ? ids + '-' + field.key + '-error' : null"
                  class="mt-1 w-full rounded-2xl border px-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-bold focus:outline-none focus:ring-1 focus:ring-brand-bold"
                  [class.border-red-300]="!!shownErrors()[field.key]" [class.border-gray-200]="!shownErrors()[field.key]" />
                @if (shownErrors()[field.key]; as message) {
                  <p [id]="ids + '-' + field.key + '-error'" class="mt-1 text-xs text-red-600">{{ message }}</p>
                }
              </div>
            }

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label [for]="ids + '-folder'" class="block text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-400">Folder</label>
                <select [id]="ids + '-folder'" [value]="form().folder ?? ''" (change)="patchFolder($any($event.target).value)"
                  class="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-bold focus:outline-none focus:ring-1 focus:ring-brand-bold">
                  @for (option of folderOptions; track option.id) {
                    <option [value]="option.id" [selected]="(form().folder ?? '') === option.id">{{ option.label }}</option>
                  }
                </select>
              </div>
              <div>
                <label [for]="ids + '-date'" class="block text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-400">Date</label>
                <select [id]="ids + '-date'" [value]="form().date" (change)="patchDate($any($event.target).value)"
                  class="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-bold focus:outline-none focus:ring-1 focus:ring-brand-bold">
                  @for (option of dateOptions; track option.id) {
                    <option [value]="option.id" [selected]="form().date === option.id">{{ option.label }}</option>
                  }
                </select>
              </div>
            </div>

            @if (form().date === 'custom') {
              <fieldset class="grid grid-cols-2 gap-3" [attr.aria-describedby]="shownErrors().date ? ids + '-date-error' : null">
                <legend class="sr-only">Custom date range</legend>
                <div>
                  <label [for]="ids + '-since'" class="block text-xs font-medium text-gray-500">From</label>
                  <input [id]="ids + '-since'" type="date" [value]="form().dateFrom ?? ''" [attr.max]="form().dateTo || null"
                    (input)="patchDay('dateFrom', $any($event.target).value)"
                    class="mt-1 w-full rounded-2xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-brand-bold focus:outline-none focus:ring-1 focus:ring-brand-bold" />
                </div>
                <div>
                  <label [for]="ids + '-until'" class="block text-xs font-medium text-gray-500">To</label>
                  <input [id]="ids + '-until'" type="date" [value]="form().dateTo ?? ''" [attr.min]="form().dateFrom || null"
                    (input)="patchDay('dateTo', $any($event.target).value)"
                    class="mt-1 w-full rounded-2xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-brand-bold focus:outline-none focus:ring-1 focus:ring-brand-bold" />
                </div>
                @if (shownErrors().date; as message) {
                  <p [id]="ids + '-date-error'" class="col-span-2 text-xs text-red-600">{{ message }}</p>
                }
              </fieldset>
            }

            <div class="flex flex-wrap gap-x-4 gap-y-2 pt-1">
              <label class="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" [checked]="form().hasAttachments" (change)="patchFlag('hasAttachments', $any($event.target).checked)"
                  class="h-4 w-4 rounded border-gray-300 text-brand-bold focus:ring-brand-bold" />
                Has attachments
              </label>
              <label class="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" [checked]="form().unread" (change)="patchFlag('unread', $any($event.target).checked)"
                  class="h-4 w-4 rounded border-gray-300 text-brand-bold focus:ring-brand-bold" />
                Unread only
              </label>
            </div>

            @if (shownErrors().form; as message) {
              <p role="alert" class="rounded-2xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">{{ message }}</p>
            }
          </div>

          <div class="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
            <button type="button" (click)="clearFilters()"
              class="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
              Clear filters
            </button>
            <button type="submit"
              class="rounded-full bg-brand-bold px-5 py-2 text-sm font-semibold text-white hover:bg-brand-ink transition-colors">
              Search
            </button>
          </div>
        </form>
      </div>
    }
  `,
})
export class MailSearchFiltersComponent implements OnChanges, OnDestroy {
  @Input() open = false;
  /** Elemento bajo el que se coloca (el buscador). */
  @Input() anchor: HTMLElement | null = null;
  /** Nodo que no cuenta como "fuera" (el botón que abre/cierra). */
  @Input() ignore: HTMLElement | null = null;
  @Input() value: MailAdvancedSearch = EMPTY_ADVANCED_SEARCH;

  @Output() readonly search = new EventEmitter<MailAdvancedSearch>();
  @Output() readonly cleared = new EventEmitter<void>();
  @Output() readonly closed = new EventEmitter<void>();

  readonly ids = `mail-search-filters-${panelSeq++}`;

  readonly textFields: readonly { key: TextField; label: string; placeholder: string }[] = [
    { key: 'from', label: 'From', placeholder: 'Name or email address' },
    { key: 'to', label: 'To', placeholder: 'Name or email address' },
    { key: 'subject', label: 'Subject', placeholder: 'Words in the subject' },
    { key: 'q', label: 'Keywords', placeholder: 'Words anywhere in the email' },
  ];

  readonly folderOptions: readonly { id: MailOperatorFolder | ''; label: string }[] = [
    { id: '', label: 'All folders' },
    { id: 'inbox', label: 'Inbox' },
    { id: 'archived', label: 'Archived' },
    { id: 'sent', label: 'Sent' },
    { id: 'drafts', label: 'Drafts' },
    { id: 'trash', label: 'Trash' },
  ];

  readonly dateOptions: readonly { id: MailDatePreset; label: string }[] = [
    { id: 'any', label: 'Any time' },
    { id: '7d', label: 'Last 7 days' },
    { id: '30d', label: 'Last 30 days' },
    { id: '90d', label: 'Last 3 months' },
    { id: 'custom', label: 'Custom range…' },
  ];

  readonly form = signal<MailAdvancedSearch>({ ...EMPTY_ADVANCED_SEARCH });
  /** Los errores se muestran tras el primer intento de buscar. */
  private readonly attempted = signal(false);
  readonly errors = computed(() => validateAdvancedSearch(this.form()));
  readonly shownErrors = computed(() => (this.attempted() ? this.errors() : {}));

  readonly sheet = signal(false);
  readonly position = signal<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly injector = inject(Injector);
  private portaled: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;
  private readonly reposition = (): void => this.place();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) {
      if (this.open) {
        this.onOpen();
      } else {
        this.detach();
      }
    }
  }

  ngOnDestroy(): void {
    this.detach();
    this.portaled?.remove();
    this.portaled = null;
  }

  patch(key: TextField, value: string): void {
    this.form.update(form => ({ ...form, [key]: value }));
  }

  patchFolder(value: string): void {
    this.form.update(form => ({ ...form, folder: (value || null) as MailOperatorFolder | null }));
  }

  patchDate(value: string): void {
    const date = value as MailDatePreset;
    this.form.update(form => ({
      ...form,
      date,
      dateFrom: date === 'custom' ? form.dateFrom : null,
      dateTo: date === 'custom' ? form.dateTo : null,
    }));
  }

  patchDay(key: 'dateFrom' | 'dateTo', value: string): void {
    this.form.update(form => ({ ...form, [key]: value || null }));
  }

  patchFlag(key: 'hasAttachments' | 'unread', value: boolean): void {
    this.form.update(form => ({ ...form, [key]: value }));
  }

  submit(): void {
    this.attempted.set(true);
    const errors = this.errors();
    if (Object.keys(errors).length > 0) {
      this.focusFirstInvalid(errors);
      return;
    }
    const form = this.form();
    this.search.emit({
      ...form,
      q: form.q.trim(),
      from: form.from.trim(),
      to: form.to.trim(),
      subject: form.subject.trim(),
      dateFrom: form.date === 'custom' && isValidDay(form.dateFrom) ? form.dateFrom : null,
      dateTo: form.date === 'custom' && isValidDay(form.dateTo) ? form.dateTo : null,
    });
  }

  /** Vacía el formulario y quita los filtros aplicados; el panel sigue abierto para empezar de nuevo. */
  clearFilters(): void {
    this.form.set({ ...EMPTY_ADVANCED_SEARCH });
    this.attempted.set(false);
    this.cleared.emit();
    this.focusFirstField();
  }

  close(): void {
    if (!this.open) {
      return;
    }
    this.closed.emit();
    const target = this.returnFocus;
    this.returnFocus = null;
    // El foco vuelve al disparador cuando el panel ya no está.
    queueMicrotask(() => target?.focus());
  }

  onKeydown(event: KeyboardEvent): void {
    const panel = this.panel()?.nativeElement;
    if (event.key === 'Tab' && panel) {
      trapTabKey(event, panel);
    }
  }

  private onOpen(): void {
    this.form.set({ ...EMPTY_ADVANCED_SEARCH, ...this.value });
    this.attempted.set(false);
    this.returnFocus = captureActiveElement();
    this.position.set(null);
    afterNextRender(() => this.attach(), { injector: this.injector });
  }

  private attach(): void {
    const panel = this.panel()?.nativeElement;
    if (!panel || !this.open) {
      return;
    }
    this.portaled = portalToBody(panel);
    this.place();
    window.addEventListener('scroll', this.reposition, { capture: true, passive: true });
    window.addEventListener('resize', this.reposition, { passive: true });
    this.focusFirstField();
  }

  private detach(): void {
    window.removeEventListener('scroll', this.reposition, { capture: true });
    window.removeEventListener('resize', this.reposition);
  }

  /** Bajo el buscador, del mismo ancho (mín. 22 rem) y sin salirse de la ventana; < lg: pantalla completa. */
  private place(): void {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    this.sheet.set(viewportWidth < 1024);
    const rect = this.anchor?.getBoundingClientRect();
    if (!rect) {
      this.position.set({ top: 80, left: 16, width: Math.min(420, viewportWidth - 32), maxHeight: viewportHeight - 96 });
      return;
    }
    const margin = 16;
    const width = Math.min(Math.max(rect.width, 352), viewportWidth - margin * 2);
    const left = Math.min(Math.max(margin, rect.left), viewportWidth - margin - width);
    const top = rect.bottom + 6;
    this.position.set({ top, left, width, maxHeight: Math.max(240, viewportHeight - top - margin) });
  }

  private focusFirstField(): void {
    queueMicrotask(() => this.panel()?.nativeElement.querySelector<HTMLInputElement>('input')?.focus());
  }

  private focusFirstInvalid(errors: Partial<Record<string, string>>): void {
    const key = (['from', 'to', 'subject', 'q'] as const).find(field => errors[field]);
    const id = key ? `${this.ids}-${key}` : errors['date'] ? `${this.ids}-since` : `${this.ids}-from`;
    queueMicrotask(() => (this.panel()?.nativeElement.querySelector<HTMLElement>(`#${id}`) ?? null)?.focus());
  }
}
