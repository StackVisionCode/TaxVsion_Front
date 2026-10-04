import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { ConfirmDialogComponent } from '@shared/ui/confirm-dialog/confirm-dialog.component';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { StateBlockComponent } from '@shared/ui/state-block/state-block.component';
import { DropdownMenuComponent, MenuItemDirective } from '@shared/ui/dropdown-menu/dropdown-menu.component';
import { formatBytes } from '@shared/utils/format.util';
import { FileViewerComponent } from '@shared/ui/file-viewer/file-viewer.component';
import { FileViewerItem } from '@shared/ui/file-viewer/file-viewer.model';
import { ClientNotesStore } from '../../data-access/client-notes.store';
import {
  ClientNoteCard,
  NOTE_COLOR_OPTIONS,
  NOTE_VISIBILITY_OPTIONS,
  NoteAttachmentResponse,
  NoteAttachmentStatus,
  NoteColorKind,
  NoteVisibility,
} from '../../data-access/client-notes.model';

/**
 * Pestaña "Notes" del perfil de cliente, cableada contra Notes.Api (`/notes`).
 *
 * El vínculo con el cliente es la referencia polimórfica del backend: las notas se crean
 * con `targetType: 'Customer'` + `targetId: clientId` y se listan con
 * `GET /notes?targetType=Customer&targetId=...`, que es el filtro por cliente REAL del
 * contrato (no hay simulación en el front).
 *
 * Diferencias con el mock que reemplaza, todas por límites del contrato:
 *  - El autor solo llega como `createdByUserId`; el nombre se resuelve best-effort con
 *    GET /auth/users y cae a "Team member" sin el permiso `users.view`.
 *  - Solo el AUTOR edita contenido/visibilidad/pin/color; archivar y borrar además los
 *    habilita `notes.view_all`. Los botones se ocultan cuando la regla no aplica.
 *  - Las notas archivadas siguen listándose (el repo solo excluye `Deleted`), así que se
 *    marcan con un chip en vez de desaparecer.
 */
@Component({
  selector: 'app-client-profile-notes',
  imports: [
    CommonModule,
    FormsModule,
    ConfirmDialogComponent,
    AvatarComponent,
    StateBlockComponent,
    DropdownMenuComponent,
    MenuItemDirective,
    FileViewerComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-notes.component.html',
})
export class ClientProfileNotesComponent implements OnChanges {
  @Input() clientId = '';

  readonly store = inject(ClientNotesStore);

  readonly visibilityOptions = NOTE_VISIBILITY_OPTIONS;
  readonly colorOptions = NOTE_COLOR_OPTIONS;

  // ---------- Redacción de una nota nueva ----------
  readonly draftText = signal('');
  readonly draftVisibility = signal<NoteVisibility>('Team');
  readonly draftColor = signal<NoteColorKind>('Default');
  readonly composerError = signal<string | null>(null);
  readonly saving = signal(false);

  // ---------- Edición en línea ----------
  readonly editingId = signal<string | null>(null);
  readonly editText = signal('');
  readonly editError = signal<string | null>(null);
  readonly editSaving = signal(false);

  readonly pendingDelete = signal<ClientNoteCard | null>(null);
  /** Adjunto pendiente de quitar (nota + adjunto) para el diálogo de confirmación. */
  readonly pendingDetach = signal<{ note: ClientNoteCard; attachment: NoteAttachmentResponse } | null>(null);

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

  // ---------- Alta ----------

  addNote(): void {
    const text = this.draftText().trim();
    if (!text || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.composerError.set(null);
    this.store.create(plainTextToHtml(text), this.draftVisibility(), this.draftColor()).subscribe({
      next: () => {
        this.draftText.set('');
        this.draftColor.set('Default');
        this.saving.set(false);
      },
      error: err => {
        this.composerError.set(toApiError(err).message);
        this.saving.set(false);
      },
    });
  }

  // ---------- Edición ----------

  startEdit(note: ClientNoteCard): void {
    this.editingId.set(note.id);
    // El contenido viaja como HTML; para el editor de texto plano se quitan las etiquetas.
    this.editText.set(htmlToPlainText(note.html));
    this.editError.set(null);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editError.set(null);
  }

  saveEdit(): void {
    const id = this.editingId();
    const text = this.editText().trim();
    if (!id || !text || this.editSaving()) {
      return;
    }
    this.editSaving.set(true);
    this.editError.set(null);
    this.store.updateContent(id, plainTextToHtml(text)).subscribe({
      next: () => {
        this.editingId.set(null);
        this.editSaving.set(false);
      },
      error: err => {
        this.editError.set(toApiError(err).message);
        this.editSaving.set(false);
      },
    });
  }

  // ---------- Acciones sueltas ----------

  togglePin(note: ClientNoteCard): void {
    this.store.togglePin(note);
  }

  toggleArchive(note: ClientNoteCard): void {
    this.store.toggleArchive(note);
  }

  changeVisibility(note: ClientNoteCard, visibility: NoteVisibility): void {
    if (visibility !== note.visibility) {
      this.store.setVisibility(note.id, visibility);
    }
  }

  pickColor(note: ClientNoteCard, colorKind: NoteColorKind): void {
    if (colorKind !== note.colorKind) {
      this.store.setColor(note.id, colorKind);
    }
  }

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

  /** Tamaño legible de un adjunto. */
  attachmentSize(sizeBytes: number): string {
    return formatBytes(sizeBytes);
  }

  // ---------- Adjuntos ----------

  /** Se ocultan los `Detached` (quitados): siguen viniendo en la respuesta pero ya no aplican. */
  visibleAttachments(note: ClientNoteCard): NoteAttachmentResponse[] {
    return note.attachments.filter(a => a.status !== 'Detached');
  }

  onAttachPicked(note: ClientNoteCard, event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.store.attachFile(note.id, input.files[0]);
      input.value = '';
    }
  }

  /** Visor global: adjuntos listos de la nota, navegables con ←/→. */
  readonly viewerOpen = signal(false);
  readonly viewerFiles = signal<FileViewerItem[]>([]);
  readonly viewerIndex = signal(0);

  previewAttachment(note: ClientNoteCard, attachment: NoteAttachmentResponse): void {
    const ready = this.visibleAttachments(note).filter(a => a.status === 'Available');
    const start = ready.findIndex(a => a.id === attachment.id);
    if (start < 0) {
      return;
    }
    this.viewerFiles.set(ready.map(a => this.store.viewerItem(a)));
    this.viewerIndex.set(start);
    this.viewerOpen.set(true);
  }

  downloadAttachment(attachment: NoteAttachmentResponse): void {
    if (attachment.status === 'Available') {
      this.store.downloadAttachment(attachment.cloudStorageFileId);
    }
  }

  requestDetach(note: ClientNoteCard, attachment: NoteAttachmentResponse): void {
    this.pendingDetach.set({ note, attachment });
  }

  confirmDetach(): void {
    const pending = this.pendingDetach();
    if (pending) {
      this.store.detachAttachment(pending.note.id, pending.attachment.cloudStorageFileId);
    }
    this.pendingDetach.set(null);
  }

  attachmentStatusLabel(status: NoteAttachmentStatus): string {
    switch (status) {
      case 'Available':
        return 'Ready';
      case 'Pending':
        return 'Scanning…';
      case 'Rejected':
        return 'Blocked';
      case 'Detached':
        return 'Removed';
    }
  }

  attachmentStatusClass(status: NoteAttachmentStatus): string {
    switch (status) {
      case 'Available':
        return 'border-emerald-200 bg-emerald-50 text-emerald-600';
      case 'Pending':
        return 'border-amber-200 bg-amber-50 text-amber-600';
      case 'Rejected':
        return 'border-red-200 bg-red-50 text-red-500';
      case 'Detached':
        return 'border-gray-200 bg-gray-50 text-gray-400';
    }
  }
}

/**
 * El editor de esta pestaña es de texto plano, pero el contrato de Notes guarda HTML
 * (`NoteContent.Html`, sanitizado en el servidor). Se escapa el texto y los saltos de línea
 * pasan a `<br>` para que lo que se escribe sea exactamente lo que se ve al renderizar.
 */
function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped.replace(/\r?\n/g, '<br>');
}

/** Camino inverso para el editor: el HTML del backend se degrada a texto plano (sin ejecutar nada, vía DOMParser). */
function htmlToPlainText(html: string): string {
  const parsed = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
  return (parsed.body.textContent ?? '').trim();
}
