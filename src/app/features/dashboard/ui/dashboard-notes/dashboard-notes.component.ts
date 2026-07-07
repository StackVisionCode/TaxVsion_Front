import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface DashboardNote {
  id: number;
  text: string;
  createdAt: Date;
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/** Colores de punto que rotan por índice: púrpuras Aether + naranja + esmeralda. */
const DOT_COLORS = ['#7C6AE0', '#FB923C', '#10B981', '#A99BEB'];

/**
 * Widget "Notes" (referencia "Aether"): input píldora con botón negro para
 * añadir notas rápidas y lista de tarjetas con punto de color, tiempo relativo
 * y botón X visible al hacer hover. Interacción 100% local, sin backend
 * (se reinicia al refrescar).
 */
@Component({
  selector: 'app-dashboard-notes',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-notes.component.html',
})
export class DashboardNotesComponent {
  readonly draft = signal('');

  readonly notes = signal<DashboardNote[]>([
    {
      id: 1,
      text: 'Called client to confirm document submission for the Q2 filing. Awaiting a callback.',
      createdAt: minutesAgo(15),
    },
    {
      id: 2,
      text: 'Client dropped off their W-2 and 1099-INT forms at the front desk. Ready for data entry.',
      createdAt: minutesAgo(150),
    },
    {
      id: 3,
      text: 'Filed Form 4868 for an automatic extension. New filing deadline is October 15.',
      createdAt: daysAgo(1),
    },
    {
      id: 4,
      text: "Waiting on the client's signature for the engagement letter before starting the return.",
      createdAt: daysAgo(4),
    },
  ]);

  private nextId = 5;

  addNote(): void {
    const text = this.draft().trim();
    if (!text) {
      return;
    }
    this.notes.update(notes => [{ id: this.nextId++, text, createdAt: new Date() }, ...notes]);
    this.draft.set('');
  }

  removeNote(id: number): void {
    this.notes.update(notes => notes.filter(note => note.id !== id));
  }

  dotColor(index: number): string {
    return DOT_COLORS[index % DOT_COLORS.length];
  }

  relativeTime(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMins < 1) {
      return 'Just now';
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    return `${diffDays}d ago`;
  }
}
