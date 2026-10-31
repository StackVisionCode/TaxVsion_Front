import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';

/** Resultado de búsqueda ya en forma de vista. */
export interface ChatSearchResult {
  id: string;
  senderName: string;
  /** Texto del mensaje o, en una nota de voz, su transcript (lo que coincidió). */
  text: string;
  time: string;
  dateGroup: string;
  isVoiceNote: boolean;
}

/** Caracteres mínimos que acepta el backend para buscar. */
export const MIN_CHAT_SEARCH_LENGTH = 2;

/**
 * F7 — Buscador de mensajes de la conversación activa (cabecera del hilo). Tonto: la búsqueda la hace el
 * store contra `GET …/messages/search` (incluye transcripts de notas de voz).
 *
 *   <app-chat-message-search [query]="q" [results]="results" [loading]="loading" [highlightedId]="id"
 *     (queryChange)="search($event)" (resultSelected)="jump($event)" (closed)="close()" />
 */
@Component({
  selector: 'app-chat-message-search',
  imports: [SearchInputComponent, InfinityLoaderComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm" data-role="chat-search">
      <div class="flex items-center gap-2">
        <app-search-input class="min-w-0 flex-1" widthClass="w-full" placeholder="Search messages and voice notes"
          ariaLabel="Search messages" [value]="query" [debounceMs]="300" (valueChange)="queryChange.emit($event)" />
        <button type="button" (click)="closed.emit()" aria-label="Close search"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
          <ion-icon name="close-outline" class="text-lg"></ion-icon>
        </button>
      </div>

      @if (loading) {
        <p class="mt-3 flex items-center gap-2 px-1 text-xs text-gray-400" aria-live="polite">
          <app-infinity-loader size="xs" /> Searching…
        </p>
      } @else if (error) {
        <p class="mt-3 px-1 text-xs text-red-600" role="alert">{{ error }}</p>
      } @else if (query.trim().length >= minLength && results.length === 0) {
        <p class="mt-3 px-1 text-xs text-gray-400" data-role="chat-search-empty">No messages found.</p>
      } @else if (results.length > 0) {
        <ul class="mt-2 max-h-60 overflow-y-auto" data-role="chat-search-results">
          @for (result of results; track result.id) {
            <li>
              <button type="button" (click)="resultSelected.emit(result.id)" data-role="chat-search-result"
                [attr.aria-current]="result.id === highlightedId ? 'true' : null"
                class="flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-gray-50"
                [class.bg-amber-50]="result.id === highlightedId">
                <span class="flex items-center gap-1.5 text-[0.6875rem] text-gray-400">
                  @if (result.isVoiceNote) {
                    <ion-icon name="mic-outline" class="text-xs" aria-label="Voice note"></ion-icon>
                  }
                  <span class="font-semibold text-gray-600">{{ result.senderName }}</span> · {{ result.dateGroup }} {{ result.time }}
                </span>
                <span class="line-clamp-2 text-sm text-gray-700">{{ result.text }}</span>
              </button>
            </li>
          }
        </ul>
        @if (highlightedId) {
          <p class="mt-2 px-1 text-[0.6875rem] text-gray-400" data-role="chat-search-not-loaded">
            That message isn't loaded in the conversation yet. Scroll up to load older messages.
          </p>
        }
        @if (truncated) {
          <p class="mt-1 px-1 text-[0.6875rem] text-gray-400">Showing the most recent matches.</p>
        }
      }
    </div>
  `,
})
export class ChatMessageSearchComponent {
  @Input() query = '';
  @Input() results: ChatSearchResult[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input() truncated = false;
  /** Resultado elegido que no está cargado en el hilo: se resalta aquí. */
  @Input() highlightedId: string | null = null;
  @Output() readonly queryChange = new EventEmitter<string>();
  @Output() readonly resultSelected = new EventEmitter<string>();
  @Output() readonly closed = new EventEmitter<void>();

  readonly minLength = MIN_CHAT_SEARCH_LENGTH;
}
