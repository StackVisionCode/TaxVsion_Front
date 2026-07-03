import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Static placeholder "sticky notes" widget for the dashboard. In the
 * production app this pulled live notes from NotesService, scoped to the
 * current user (or a selected teammate for account owners) and offered an
 * image lightbox backed by a shared component. Here it's a self-contained
 * mock: a fixed local array of notes plus a purely-local detail modal and
 * image preview overlay, no HTTP/services involved.
 */
type NoteColor = 'yellow' | 'green' | 'orange' | 'blue' | 'pink' | 'purple';

interface DashboardNote {
  id: string;
  title: string;
  description: string;
  color: NoteColor;
  createdAt: Date;
  updatedAt?: Date;
  imageUrl?: string;
  imageFileName?: string;
  customerName?: string;
  customerId?: string;
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

const MOCK_NOTES: DashboardNote[] = [
  {
    id: 'note-1',
    title: 'Follow up call',
    description: 'Called client to confirm document submission for the Q2 filing. Awaiting a callback to finalize the schedule.',
    color: 'yellow',
    createdAt: minutesAgo(15),
  },
  {
    id: 'note-2',
    title: 'W-2 received',
    description: 'Client dropped off their W-2 and 1099-INT forms at the front desk. Ready to start data entry.',
    color: 'green',
    createdAt: minutesAgo(150),
    customerName: 'Maria Gonzalez',
    customerId: 'cust-1042',
    imageUrl: 'https://picsum.photos/seed/w2form/640/420',
    imageFileName: 'w2-2024.jpg',
  },
  {
    id: 'note-3',
    title: 'Extension filed',
    description: 'Filed Form 4868 for an automatic extension. New filing deadline is October 15.',
    color: 'blue',
    createdAt: daysAgo(1),
  },
  {
    id: 'note-4',
    title: 'Missing signature',
    description: "Waiting on the client's signature for the engagement letter before we can start the return.",
    color: 'pink',
    createdAt: daysAgo(4),
    customerName: 'David Chen',
    customerId: 'cust-2087',
  },
  {
    id: 'note-5',
    title: 'Amended return',
    description: 'Reviewed the prior year return and found a deduction discrepancy. Preparing a 1040-X to correct it.',
    color: 'purple',
    createdAt: daysAgo(9),
    updatedAt: daysAgo(2),
  },
];

const COLOR_CLASSES: Record<NoteColor, string> = {
  yellow: 'bg-yellow-200 hover:bg-yellow-300',
  green: 'bg-green-200 hover:bg-green-300',
  orange: 'bg-orange-200 hover:bg-orange-300',
  blue: 'bg-blue-200 hover:bg-blue-300',
  pink: 'bg-pink-200 hover:bg-pink-300',
  purple: 'bg-purple-200 hover:bg-purple-300',
};

const CORNER_COLOR_CLASSES: Record<NoteColor, string> = {
  yellow: 'border-t-yellow-300',
  green: 'border-t-green-300',
  orange: 'border-t-orange-300',
  blue: 'border-t-blue-300',
  pink: 'border-t-pink-300',
  purple: 'border-t-purple-300',
};

const COLOR_BADGE_CLASSES: Record<NoteColor, string> = {
  yellow: 'bg-yellow-400',
  green: 'bg-green-400',
  orange: 'bg-orange-400',
  blue: 'bg-blue-400',
  pink: 'bg-pink-400',
  purple: 'bg-purple-400',
};

const COLOR_LABELS: Record<NoteColor, string> = {
  yellow: 'Yellow',
  green: 'Green',
  orange: 'Orange',
  blue: 'Blue',
  pink: 'Pink',
  purple: 'Purple',
};

@Component({
  selector: 'app-dashboard-notes',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-notes.component.html',
  styleUrl: './dashboard-notes.component.css',
})
export class DashboardNotesComponent {
  readonly notes = signal<DashboardNote[]>(MOCK_NOTES);
  readonly selectedNote = signal<DashboardNote | null>(null);
  readonly showDetailModal = signal(false);

  readonly lightboxOpen = signal(false);
  readonly lightboxUrl = signal('');
  readonly lightboxFilename = signal('');

  readonly hasNotes = computed(() => this.notes().length > 0);
  readonly displayedNotes = computed(() => this.notes().slice(0, 6));

  openDetails(note: DashboardNote): void {
    this.selectedNote.set(note);
    this.showDetailModal.set(true);
  }

  closeModal(): void {
    this.showDetailModal.set(false);
    setTimeout(() => this.selectedNote.set(null), 300);
  }

  getColorClass(color: NoteColor): string {
    return COLOR_CLASSES[color] ?? 'bg-gray-200 hover:bg-gray-300';
  }

  getCornerColorClass(color: NoteColor): string {
    return CORNER_COLOR_CLASSES[color] ?? 'border-t-gray-300';
  }

  getColorBadgeClass(color: NoteColor): string {
    return COLOR_BADGE_CLASSES[color] ?? 'bg-gray-400';
  }

  getColorLabel(color: NoteColor): string {
    return COLOR_LABELS[color] ?? color;
  }

  formatDate(date: Date): string {
    const now = new Date();
    const noteDate = new Date(date);
    const diffMs = now.getTime() - noteDate.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMins < 60) {
      return diffMins <= 1 ? 'Just now' : `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    return noteDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  onImageError(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }

  openImageLightbox(url: string, filename: string): void {
    this.lightboxUrl.set(url);
    this.lightboxFilename.set(filename || 'image');
    this.lightboxOpen.set(true);
  }

  closeLightbox(): void {
    this.lightboxOpen.set(false);
    this.lightboxUrl.set('');
    this.lightboxFilename.set('');
  }
}
