import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toApiError } from '@core/models/api-error.model';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { InfinityLoaderComponent } from '@shared/ui/infinity-loader/infinity-loader.component';
import { StatusPillComponent } from '@shared/ui/status-pill/status-pill.component';
import { TooltipDirective } from '@shared/ui/tooltip/tooltip.directive';
import { formatBytes, formatRelativeTime } from '@shared/utils/format.util';
import { ClientNotesStore } from '../../data-access/client-notes.store';
import {
  ClientNoteCard,
  NOTE_COLOR_OPTIONS,
  NOTE_VISIBILITY_OPTIONS,
  NoteAttachmentResponse,
  NoteColorKind,
  NoteVisibility,
} from '../../data-access/client-notes.model';
import {
  attachmentIcon,
  attachmentStatusLabel,
  attachmentStatusHint,
  attachmentStatusTone,
  autosizeTextarea,
  htmlToPlainText,
  isLongNote,
  isSubmitShortcut,
  plainTextToHtml,
  submitShortcutLabel,
} from '../../utils/client-notes-view';

export interface NoteAttachmentEvent {
  note: ClientNoteCard;
  attachment: NoteAttachmentResponse;
}

const EDIT_MAX_HEIGHT_PX = 420;

/**
 * Tarjeta de una nota del feed: autor + tiempo relativo, insignias (visibilidad, etiqueta, pin,
 * archivada), cuerpo con "Show more", adjuntos como chips y acciones. Las acciones rápidas (pin,
 * editar, adjuntar) son iconos con tooltip; el resto vive en el menú ⋯. Los diálogos de borrar /
 * quitar adjunto y el visor son del padre (uno solo para todo el feed).
 */
@Component({
  selector: 'app-client-note-card',
  imports: [AvatarComponent, DropdownMenuComponent, MenuItemDirective, StatusPillComponent, TooltipDirective, InfinityLoaderComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './client-note-card.component.html',
  styles: `
    .note-in {
      animation: note-in 220ms cubic-bezier(0.2, 0, 0, 1) both;
    }
    @keyframes note-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        /* "none": un transform activo encerraría los fixed de los hijos. */
        transform: none;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .note-in {
        animation: none;
      }
    }
  `,
})
export class ClientNoteCardComponent {
  readonly note = input.required<ClientNoteCard>();
  /** Reloj del padre (se refresca cada minuto) para el tiempo relativo. */
  readonly now = input<number>(Date.now());

  readonly deleteRequested = output<ClientNoteCard>();
  readonly detachRequested = output<NoteAttachmentEvent>();
  readonly previewRequested = output<NoteAttachmentEvent>();

  readonly store = inject(ClientNotesStore);
  private readonly injector = inject(Injector);
  private readonly editBox = viewChild<ElementRef<HTMLTextAreaElement>>('editBox');

  readonly visibilityOptions = NOTE_VISIBILITY_OPTIONS;
  readonly colorOptions = NOTE_COLOR_OPTIONS;
  readonly shortcut = submitShortcutLabel();

  readonly editing = signal(false);
  readonly editText = signal('');
  readonly editError = signal<string | null>(null);
  readonly editSaving = signal(false);
  readonly expanded = signal(false);

  readonly busy = computed(() => this.store.isBusy(this.note().id));
  readonly relativeTime = computed(() => formatRelativeTime(this.note().createdAtUtc, this.now()));
  readonly visibility = computed(
    () => this.visibilityOptions.find(option => option.value === this.note().visibility) ?? this.visibilityOptions[0],
  );
  readonly long = computed(() => isLongNote(this.note().plainText));
  readonly attachments = computed(() => this.note().attachments.filter(a => a.status !== 'Detached'));
  readonly hasMenu = computed(() => this.note().canEdit || this.note().canManage);
  readonly cardClass = computed(() => {
    const note = this.note();
    const surface = note.isArchived ? 'bg-gray-50' : 'bg-white';
    return `${surface} ${note.accentClass ? 'pl-5' : 'pl-4'}`;
  });

  // ---------- Acciones rápidas ----------

  togglePin(): void {
    this.store.togglePin(this.note());
  }

  onAttachPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length > 0) {
      this.store.attachFiles(this.note().id, files);
    }
    input.value = '';
  }

  // ---------- Menú ⋯ ----------

  changeVisibility(visibility: NoteVisibility): void {
    if (visibility !== this.note().visibility) {
      this.store.setVisibility(this.note().id, visibility);
    }
  }

  pickColor(colorKind: NoteColorKind, menu: DropdownMenuComponent): void {
    menu.close();
    if (colorKind !== this.note().colorKind) {
      this.store.setColor(this.note().id, colorKind);
    }
  }

  toggleArchive(): void {
    this.store.toggleArchive(this.note());
  }

  // ---------- Edición en línea (PUT /notes/{id}/content) ----------

  startEdit(): void {
    this.editText.set(htmlToPlainText(this.note().html));
    this.editError.set(null);
    this.editing.set(true);
    afterNextRender(
      () => {
        const box = this.editBox()?.nativeElement;
        if (!box) return;
        autosizeTextarea(box, EDIT_MAX_HEIGHT_PX);
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      },
      { injector: this.injector },
    );
  }

  cancelEdit(): void {
    if (this.editSaving()) return;
    this.editing.set(false);
    this.editError.set(null);
  }

  onEditInput(event: Event): void {
    const box = event.target as HTMLTextAreaElement;
    this.editText.set(box.value);
    autosizeTextarea(box, EDIT_MAX_HEIGHT_PX);
  }

  onEditKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelEdit();
    } else if (isSubmitShortcut(event)) {
      event.preventDefault();
      this.saveEdit();
    }
  }

  saveEdit(): void {
    const text = this.editText().trim();
    if (!text || this.editSaving()) return;
    this.editSaving.set(true);
    this.editError.set(null);
    this.store.updateContent(this.note().id, plainTextToHtml(text)).subscribe({
      next: () => {
        this.editSaving.set(false);
        this.editing.set(false);
      },
      error: err => {
        this.editError.set(toApiError(err).message);
        this.editSaving.set(false);
      },
    });
  }

  // ---------- Adjuntos ----------

  preview(attachment: NoteAttachmentResponse): void {
    this.previewRequested.emit({ note: this.note(), attachment });
  }

  download(attachment: NoteAttachmentResponse): void {
    if (attachment.status === 'Available') {
      this.store.downloadAttachment(attachment.cloudStorageFileId);
    }
  }

  requestDetach(attachment: NoteAttachmentResponse): void {
    this.detachRequested.emit({ note: this.note(), attachment });
  }

  readonly iconFor = (a: NoteAttachmentResponse): string => attachmentIcon(a.contentType, a.displayName);
  readonly sizeOf = (a: NoteAttachmentResponse): string => formatBytes(a.sizeBytes);
  readonly statusLabel = attachmentStatusLabel;
  readonly statusTone = attachmentStatusTone;
  readonly statusHint = attachmentStatusHint;
}
