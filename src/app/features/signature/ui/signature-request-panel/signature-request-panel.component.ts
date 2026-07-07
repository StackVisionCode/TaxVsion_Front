import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Signer, SignatureRequest } from '../signature-table/signature-table.component';

const SIGNER_COLORS = ['bg-indigo-500', 'bg-orange-500', 'bg-[#7C6AE0]', 'bg-emerald-500', 'bg-gray-900'];

/**
 * Overlay de creación de una solicitud de firma (mismo patrón que
 * campaign-form-panel/meeting-schedule-panel): tarjeta centrada
 * `rounded-[28px]` sobre backdrop con stopPropagation. A diferencia de esos
 * paneles, este es exclusivamente de creación (una solicitud de firma no se
 * edita una vez enviada, solo se cancela o se reenvía desde la tabla), por
 * lo que no recibe ningún @Input de "registro a editar" ni necesita el
 * patrón isEditMode/ngOnChanges. Los firmantes se arman con un mini-form
 * (nombre + email) y un botón fantasma "Add signer" que agrega un chip
 * removible, igual que la lista de participantes de meeting-schedule-panel
 * pero con email además de nombre.
 */
@Component({
  selector: 'app-signature-request-panel',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './signature-request-panel.component.html',
})
export class SignatureRequestPanelComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();
  @Output() sent = new EventEmitter<SignatureRequest>();

  readonly documentName = signal('');
  readonly client = signal('');
  readonly dueDate = signal('');
  readonly notes = signal('');

  readonly signerNameDraft = signal('');
  readonly signerEmailDraft = signal('');
  readonly signers = signal<Signer[]>([]);

  readonly canSend = computed(
    () => this.documentName().trim().length > 0 && this.client().trim().length > 0 && this.signers().length > 0,
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.resetForm();
    }
  }

  addSigner(): void {
    const name = this.signerNameDraft().trim();
    const email = this.signerEmailDraft().trim();
    if (!name || !email) {
      return;
    }
    const initials = name
      .split(' ')
      .map(part => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    const color = SIGNER_COLORS[this.signers().length % SIGNER_COLORS.length];
    const signer: Signer = { name, initials, email, color, status: 'pending', signedAt: null };
    this.signers.update(list => [...list, signer]);
    this.signerNameDraft.set('');
    this.signerEmailDraft.set('');
  }

  removeSigner(index: number): void {
    this.signers.update(list => list.filter((_, i) => i !== index));
  }

  close(): void {
    this.closed.emit();
    this.resetForm();
  }

  send(): void {
    if (!this.canSend()) {
      return;
    }
    const result: SignatureRequest = {
      id: `signature-${Date.now()}`,
      documentName: this.documentName().trim(),
      client: this.client().trim(),
      signers: this.signers(),
      status: 'pending',
      sentDate: new Date().toISOString().slice(0, 10),
      dueDate: this.dueDate() || new Date().toISOString().slice(0, 10),
      completedDate: null,
      notes: this.notes().trim(),
    };
    this.sent.emit(result);
    this.resetForm();
  }

  private resetForm(): void {
    this.documentName.set('');
    this.client.set('');
    this.dueDate.set('');
    this.notes.set('');
    this.signerNameDraft.set('');
    this.signerEmailDraft.set('');
    this.signers.set([]);
  }
}
