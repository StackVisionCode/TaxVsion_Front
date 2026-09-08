import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { toApiError } from '@core/models/api-error.model';
import { NoteResponse } from '../../../clients/data-access/client-notes.model';
import { DashboardNotesService } from '../../data-access/dashboard-notes.service';
import { DashboardWidgetStateComponent } from '../dashboard-widget-state/dashboard-widget-state.component';

/** Cuántas notas se traen y se listan en el widget. */
const PAGE_SIZE = 8;

/** Colores de punto que rotan por índice (paleta azul de marca + acentos). */
const DOT_COLORS = ['rgb(var(--color-indigo-600-rgb, 30 70 107))', '#FB923C', '#10B981', 'rgb(var(--color-orange-500-rgb, 103 186 244))'];

/**
 * Widget "Notes".
 *
 * Antes traía 4 notas inventadas ("Filed Form 4868 for an automatic
 * extension…") y el input SÍ dejaba escribir — pero la nota vivía solo en
 * memoria y desaparecía al refrescar. Prometía persistencia sin tenerla.
 *
 * Notes.Api sí existe y expone `GET /notes/mine` (mis notas) y `POST /notes`.
 * El widget ahora lista las notas reales del usuario y las que escribe acá se
 * guardan como notas "sueltas" (`targetType: 'None'`, visibilidad Private) —
 * el único target que el dominio permite sin objeto asociado.
 *
 * `GET /notes/mine` devuelve TODAS mis notas, incluidas las escritas en el
 * perfil de un cliente; esas se marcan con un chip y no se pueden borrar
 * desde acá, para no eliminar por accidente una nota de cliente desde el
 * dashboard.
 */
@Component({
  selector: 'app-dashboard-notes',
  imports: [CommonModule, FormsModule, DashboardWidgetStateComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-notes.component.html',
})
export class DashboardNotesComponent implements OnInit {
  private readonly service = inject(DashboardNotesService);
  private readonly auth = inject(AuthService);

  readonly draft = signal('');
  readonly notes = signal<NoteResponse[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Error de guardar/borrar, separado del error de carga. */
  readonly actionError = signal<string | null>(null);
  readonly saving = signal(false);

  /** Crear notas exige `notes.manage`: sin él no se muestra el compositor. */
  readonly canCreate = computed(
    () => this.auth.currentUser()?.permissions.includes('notes.manage') ?? false,
  );

  ngOnInit(): void {
    this.loadNotes();
  }

  addNote(): void {
    const text = this.draft().trim();
    if (!text || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.actionError.set(null);
    this.service.createQuickNote(text).subscribe({
      next: created => {
        this.notes.update(list => [created, ...list].slice(0, PAGE_SIZE));
        this.draft.set('');
        this.saving.set(false);
      },
      error: err => {
        this.actionError.set(toApiError(err).message);
        this.saving.set(false);
      },
    });
  }

  removeNote(note: NoteResponse): void {
    // Update optimista con rollback: si el backend rechaza, la nota vuelve.
    const snapshot = this.notes();
    this.notes.update(list => list.filter(n => n.id !== note.id));
    this.actionError.set(null);
    this.service.remove(note.id).subscribe({
      error: err => {
        this.notes.set(snapshot);
        this.actionError.set(toApiError(err).message);
      },
    });
  }

  dismissActionError(): void {
    this.actionError.set(null);
  }

  trackByNoteId(_index: number, note: NoteResponse): string {
    return note.id;
  }

  dotColor(index: number): string {
    return DOT_COLORS[index % DOT_COLORS.length];
  }

  /** Texto plano que ya calcula el backend a partir del HTML (280 chars). */
  previewOf(note: NoteResponse): string {
    return note.contentPreview?.trim() || 'Empty note';
  }

  /** Las notas atadas a un cliente/tarea se marcan y no se borran desde el dashboard. */
  isQuickNote(note: NoteResponse): boolean {
    return note.targetType === 'None';
  }

  targetLabel(note: NoteResponse): string {
    return note.targetType === 'Customer' ? 'Client note' : `${note.targetType} note`;
  }

  relativeTime(isoUtc: string): string {
    const then = new Date(isoUtc).getTime();
    if (Number.isNaN(then)) {
      return '';
    }
    const minutes = Math.floor(Math.max(0, Date.now() - then) / 60_000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private loadNotes(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.listMine(1, PAGE_SIZE).subscribe({
      next: result => {
        this.notes.set(result.items ?? []);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(toApiError(err).message);
        this.loading.set(false);
      },
    });
  }
}
