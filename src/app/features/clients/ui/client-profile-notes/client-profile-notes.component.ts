import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  Input,
  OnChanges,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import { FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';
import { FilterChipOption, FilterChipsComponent } from '@shared/ui/filter-chips/filter-chips.component';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { SearchInputComponent } from '@shared/ui/search-input/search-input.component';
import { SegmentedComponent, SegmentedOption } from '@shared/ui/segmented/segmented.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { TooltipDirective } from '@shared/ui/tooltip/tooltip.directive';
import { formatBytes } from '@shared/utils/format.util';
import { ClientNotesStore } from '../../data-access/client-notes.store';
import {
  ClientNoteCard,
  NOTE_COLOR_OPTIONS,
  NOTE_MAX_HTML_LENGTH,
  NOTE_VISIBILITY_OPTIONS,
  NoteColorKind,
  NoteVisibility,
} from '../../data-access/client-notes.model';
import {
  attachmentIcon,
  autosizeTextarea,
  groupNotesByDay,
  isSubmitShortcut,
  plainTextToHtml,
  sortNotesNewestFirst,
  submitShortcutLabel,
} from '../../utils/client-notes-view';
import { ClientNoteCardComponent, NoteAttachmentEvent } from './client-note-card.component';

export type NotesFilter = 'all' | 'pinned' | 'client' | 'archived';

const COMPOSER_MAX_HEIGHT_PX = 320;
/** Con pocas notas la barra de búsqueda/filtros es ruido. */
const TOOLBAR_MIN_NOTES = 4;
/** El contador aparece al acercarse al límite del backend. */
const COUNTER_FROM_RATIO = 0.8;
const CLOCK_TICK_MS = 60_000;

/**
 * Pestaña "Notes" del perfil de cliente, cableada contra Notes.Api (`/notes`).
 *
 * Las notas se crean con `targetType: 'Customer'` + `targetId: clientId` y se listan con
 * `GET /notes?targetType=Customer&targetId=...` (hasta 100, el máximo del endpoint). Búsqueda y
 * filtros son del lado cliente: el endpoint por cliente no acepta ni `q` ni estado.
 *
 * Límites del contrato que condicionan la UI:
 *  - El autor solo llega como `createdByUserId`; el nombre se resuelve best-effort con GET /auth/users.
 *  - Solo el AUTOR edita contenido/visibilidad/pin/color/adjuntos; archivar y borrar además los
 *    habilita `notes.view_all`. Las acciones que no aplican no se pintan.
 *  - POST /notes no acepta adjuntos: los que se eligen en el composer se suben y enlazan justo
 *    después de crear la nota.
 */
@Component({
  selector: 'app-client-profile-notes',
  imports: [
    AvatarComponent,
    ConfirmDialogComponent,
    DropdownMenuComponent,
    MenuItemDirective,
    FileViewerComponent,
    FilterChipsComponent,
    InfinityLoaderComponent,
    SearchInputComponent,
    SegmentedComponent,
    SkeletonComponent,
    StateBlockComponent,
    TooltipDirective,
    ClientNoteCardComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-profile-notes.component.html',
})
export class ClientProfileNotesComponent implements OnChanges {
  @Input() clientId = '';

  readonly store = inject(ClientNotesStore);
  private readonly composerBox = viewChild<ElementRef<HTMLTextAreaElement>>('composerBox');

  readonly colorOptions = NOTE_COLOR_OPTIONS;
  readonly visibilitySegments: SegmentedOption<NoteVisibility>[] = NOTE_VISIBILITY_OPTIONS.map(option => ({
    id: option.value,
    label: option.label,
    icon: option.icon,
  }));
  readonly shortcut = submitShortcutLabel();

  /** Reloj para los tiempos relativos ("5m ago"), refrescado cada minuto. */
  readonly now = signal(Date.now());

  // ---------- Composer ----------
  readonly draftText = signal('');
  readonly draftVisibility = signal<NoteVisibility>('Team');
  readonly draftColor = signal<NoteColorKind>('Default');
  readonly draftFiles = signal<File[]>([]);
  readonly composerError = signal<string | null>(null);
  readonly saving = signal(false);

  readonly draftHtmlLength = computed(() => plainTextToHtml(this.draftText().trim()).length);
  readonly overLimit = computed(() => this.draftHtmlLength() > NOTE_MAX_HTML_LENGTH);
  readonly showCounter = computed(() => this.draftHtmlLength() >= NOTE_MAX_HTML_LENGTH * COUNTER_FROM_RATIO);
  readonly maxLength = NOTE_MAX_HTML_LENGTH;
  readonly canSubmit = computed(() => !!this.draftText().trim() && !this.saving() && !this.overLimit());
  readonly draftColorOption = computed(
    () => this.colorOptions.find(option => option.value === this.draftColor()) ?? this.colorOptions[0],
  );
  readonly draftVisibilityHint = computed(
    () => NOTE_VISIBILITY_OPTIONS.find(option => option.value === this.draftVisibility())?.hint ?? '',
  );

  // ---------- Feed ----------
  readonly filter = signal<NotesFilter>('all');
  readonly search = signal('');

  private readonly active = computed(() => this.store.notes().filter(note => !note.isArchived));
  readonly counts = computed(() => {
    const active = this.active();
    return {
      all: active.length,
      pinned: active.filter(note => note.isPinned).length,
      client: active.filter(note => note.visibility === 'ClientVisible').length,
      archived: this.store.notes().length - active.length,
    };
  });

  readonly showToolbar = computed(() => this.store.notes().length >= TOOLBAR_MIN_NOTES || this.counts().archived > 0);

  readonly filterOptions = computed<FilterChipOption<NotesFilter>[]>(() => {
    const counts = this.counts();
    const options: FilterChipOption<NotesFilter>[] = [
      { id: 'all', label: 'All', count: counts.all },
      { id: 'pinned', label: 'Pinned', count: counts.pinned },
      { id: 'client', label: 'Visible to client', count: counts.client },
    ];
    if (counts.archived > 0 || this.filter() === 'archived') {
      options.push({ id: 'archived', label: 'Archived', count: counts.archived });
    }
    return options;
  });

  /** Notas del filtro + búsqueda (texto, autor y nombres de adjuntos), más recientes primero. */
  readonly visibleNotes = computed(() => {
    const filter = this.filter();
    const term = this.search().trim().toLowerCase();
    const source = filter === 'archived' ? this.store.notes().filter(note => note.isArchived) : this.active();
    const filtered = source.filter(note => {
      if (filter === 'pinned' && !note.isPinned) return false;
      if (filter === 'client' && note.visibility !== 'ClientVisible') return false;
      if (!term) return true;
      return (
        note.plainText.toLowerCase().includes(term) ||
        note.authorName.toLowerCase().includes(term) ||
        note.attachments.some(a => a.displayName.toLowerCase().includes(term))
      );
    });
    return sortNotesNewestFirst(filtered);
  });

  /** Sección "Pinned" arriba (salvo en los filtros Pinned/Archived, donde sería redundante). */
  readonly pinnedNotes = computed(() => {
    const filter = this.filter();
    return filter === 'pinned' || filter === 'archived' ? [] : this.visibleNotes().filter(note => note.isPinned);
  });

  readonly feedGroups = computed(() => {
    const pinnedIds = new Set(this.pinnedNotes().map(note => note.id));
    return groupNotesByDay(
      this.visibleNotes().filter(note => !pinnedIds.has(note.id)),
      this.now(),
    );
  });

  readonly filteredEmpty = computed(() => this.store.notes().length > 0 && this.visibleNotes().length === 0);

  // ---------- Diálogos y visor ----------
  readonly pendingDelete = signal<ClientNoteCard | null>(null);
  readonly pendingDetach = signal<NoteAttachmentEvent | null>(null);
  readonly viewerOpen = signal(false);
  readonly viewerFiles = signal<FileViewerItem[]>([]);
  readonly viewerIndex = signal(0);

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), CLOCK_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  ngOnChanges(): void {
    if (this.clientId) {
      this.store.load(this.clientId);
    }
  }

  retry(): void {
    this.store.refresh();
  }

  dismissActionError(): void {
    this.store.clearActionError();
  }

  clearFilters(): void {
    this.filter.set('all');
    this.search.set('');
  }

  // ---------- Composer ----------

  onDraftInput(event: Event): void {
    const box = event.target as HTMLTextAreaElement;
    this.draftText.set(box.value);
    autosizeTextarea(box, COMPOSER_MAX_HEIGHT_PX);
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (isSubmitShortcut(event)) {
      event.preventDefault();
      this.addNote();
    }
  }

  onComposerFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = '';
    if (picked.length === 0) return;
    this.draftFiles.update(current => {
      const key = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
      const seen = new Set(current.map(key));
      return [...current, ...picked.filter(file => !seen.has(key(file)))];
    });
  }

  removeDraftFile(index: number): void {
    this.draftFiles.update(files => files.filter((_, i) => i !== index));
  }

  addNote(): void {
    if (!this.canSubmit()) return;
    const files = this.draftFiles();
    this.saving.set(true);
    this.composerError.set(null);
    this.store.create(plainTextToHtml(this.draftText().trim()), this.draftVisibility(), this.draftColor()).subscribe({
      next: noteId => {
        // POST /notes no acepta adjuntos: se enlazan a la nota recién creada.
        this.store.attachFiles(noteId, files);
        this.draftText.set('');
        this.draftColor.set('Default');
        // Vuelve a Team: que la siguiente nota no salga visible al cliente por inercia.
        this.draftVisibility.set('Team');
        this.draftFiles.set([]);
        this.saving.set(false);
        const box = this.composerBox()?.nativeElement;
        if (box) {
          box.value = '';
          autosizeTextarea(box, COMPOSER_MAX_HEIGHT_PX);
        }
      },
      error: err => {
        // El borrador se conserva para reintentar.
        this.composerError.set(toApiError(err).message);
        this.saving.set(false);
      },
    });
  }

  readonly fileIcon = (file: File): string => attachmentIcon(file.type, file.name);
  readonly fileSize = (file: File): string => formatBytes(file.size);

  // ---------- Borrado / adjuntos ----------

  requestDelete(note: ClientNoteCard): void {
    this.pendingDelete.set(note);
  }

  confirmDelete(): void {
    const note = this.pendingDelete();
    if (note) {
      this.store.remove(note.id);
    }
    this.pendingDelete.set(null);
  }

  requestDetach(event: NoteAttachmentEvent): void {
    this.pendingDetach.set(event);
  }

  confirmDetach(): void {
    const pending = this.pendingDetach();
    if (pending) {
      this.store.detachAttachment(pending.note.id, pending.attachment.cloudStorageFileId);
    }
    this.pendingDetach.set(null);
  }

  /** Visor global: adjuntos listos de la nota, navegables con ←/→. */
  previewAttachment({ note, attachment }: NoteAttachmentEvent): void {
    const ready = note.attachments.filter(a => a.status === 'Available');
    const start = ready.findIndex(a => a.id === attachment.id);
    if (start < 0) return;
    this.viewerFiles.set(ready.map(a => this.store.viewerItem(a)));
    this.viewerIndex.set(start);
    this.viewerOpen.set(true);
  }
}
