import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, Input, OnChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toApiError } from '@core/models/api-error.model';
import { ConfirmDialogComponent } from '../../../../shared/ui/confirm-dialog/confirm-dialog.component';
import { ClientNotesStore } from '../../data-access/client-notes.store';
import {
  ClientNoteCard,
  NOTE_COLOR_OPTIONS,
  NOTE_VISIBILITY_OPTIONS,
  NoteColorKind,
  NoteVisibility,
  initialsOf,
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
  imports: [CommonModule, FormsModule, ConfirmDialogComponent],
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

  /** Menú de color abierto (uno por tarjeta). */
  readonly openColorMenuId = signal<string | null>(null);

  readonly pendingDelete = signal<ClientNoteCard | null>(null);

  ngOnChanges(): void {
    if (this.clientId) {
      this.store.load(this.clientId);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="note-color"]')) {
      this.openColorMenuId.set(null);
    }
  }

  initials(name: string): string {
    return initialsOf(name);
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

  toggleColorMenu(note: ClientNoteCard): void {
    this.openColorMenuId.update(current => (current === note.id ? null : note.id));
  }

  pickColor(note: ClientNoteCard, colorKind: NoteColorKind): void {
    this.openColorMenuId.set(null);
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

  /** Tamaño legible de un adjunto (los adjuntos son de solo lectura en esta pestaña). */
  attachmentSize(sizeBytes: number): string {
    if (sizeBytes < 1024) {
      return `${sizeBytes} B`;
    }
    if (sizeBytes < 1024 * 1024) {
      return `${Math.round(sizeBytes / 1024)} KB`;
    }
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
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
