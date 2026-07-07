import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, Input, OnChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type SettingField =
  | { kind: 'toggle'; key: string; label: string; description: string; value: boolean }
  | { kind: 'select'; key: string; label: string; description: string; value: string; options: string[] }
  | { kind: 'text'; key: string; label: string; description: string; value: string };

const PANELS: Record<string, SettingField[]> = {
  overview: [
    { kind: 'text', key: 'firmName', label: 'Firm name', description: 'Shown on invoices and client emails', value: 'Reyes Tax & Accounting' },
    { kind: 'select', key: 'timezone', label: 'Default timezone', description: 'Used for due dates and reminders', value: 'Eastern Time (ET)', options: ['Eastern Time (ET)', 'Central Time (CT)', 'Mountain Time (MT)', 'Pacific Time (PT)'] },
    { kind: 'toggle', key: 'darkMode', label: 'Compact sidebar by default', description: 'Start every session with the sidebar collapsed', value: false },
  ],
  accounts: [
    { kind: 'toggle', key: 'requireSsn', label: 'Require SSN/ITIN on intake', description: 'Block saving a new client without this field', value: true },
    { kind: 'select', key: 'defaultType', label: 'Default client type', description: 'Pre-selected when adding a new client', value: 'Individual', options: ['Individual', 'Business', 'Trust'] },
  ],
  documents: [
    { kind: 'toggle', key: 'autoOcr', label: 'Auto-scan uploaded PDFs', description: 'Extract text for search automatically', value: true },
    { kind: 'select', key: 'retention', label: 'Retention policy', description: 'How long deleted files stay in the recycle bin', value: '30 days', options: ['14 days', '30 days', '90 days', 'Forever'] },
  ],
  invoices: [
    { kind: 'select', key: 'currency', label: 'Default currency', description: 'Applied to new invoices', value: 'USD ($)', options: ['USD ($)', 'CAD ($)', 'EUR (€)'] },
    { kind: 'toggle', key: 'autoReminders', label: 'Auto-reminders for unpaid invoices', description: 'Send a reminder 3 days after the due date', value: true },
  ],
  mail: [
    { kind: 'toggle', key: 'emailNotifs', label: 'Email notifications', description: 'Notify me about client replies and uploads', value: true },
    { kind: 'toggle', key: 'signature', label: 'Signature on outgoing mail', description: "Append your firm's signature block", value: true },
    { kind: 'text', key: 'replyTo', label: 'Default reply-to', description: 'Used when clients respond to notifications', value: 'support@taxvision.com' },
  ],
  signature: [
    { kind: 'toggle', key: 'reminders', label: 'Auto-remind unsigned documents', description: 'Send a nudge after 48 hours', value: true },
    { kind: 'select', key: 'expiry', label: 'Link expiration', description: 'How long a signing link stays valid', value: '7 days', options: ['3 days', '7 days', '14 days', '30 days'] },
  ],
  meetings: [
    { kind: 'toggle', key: 'waitingRoom', label: 'Enable waiting room', description: 'Hold clients until you admit them', value: true },
    { kind: 'toggle', key: 'recordByDefault', label: 'Record meetings by default', description: 'Client is notified when recording starts', value: false },
  ],
  ai: [
    { kind: 'select', key: 'tone', label: 'Suggestion tone', description: 'How the assistant phrases its answers', value: 'Professional', options: ['Professional', 'Friendly', 'Concise'] },
    { kind: 'toggle', key: 'proactive', label: 'Proactive risk alerts', description: 'Let AI flag anomalies without being asked', value: true },
  ],
};

/**
 * Panel de detalle de un módulo de Settings (estilo "Aether"): toggles
 * píldora, dropdown con patrón document:click y campos de texto píldora.
 * "Save changes" muestra un chip de confirmación transitorio. Todo local.
 */
@Component({
  selector: 'app-settings-panel',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './settings-panel.component.html',
})
export class SettingsPanelComponent implements OnChanges {
  @Input() moduleId = 'overview';
  @Input() moduleTitle = 'Overview';

  readonly fields = signal<SettingField[]>(PANELS['overview']);
  readonly openDropdownKey = signal<string | null>(null);
  readonly showSaved = signal(false);

  ngOnChanges(): void {
    this.fields.set(PANELS[this.moduleId] ?? []);
    this.openDropdownKey.set(null);
    this.showSaved.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown-field]') && this.openDropdownKey()) {
      this.openDropdownKey.set(null);
    }
  }

  toggleField(key: string): void {
    this.fields.update(fields =>
      fields.map(f => (f.kind === 'toggle' && f.key === key ? { ...f, value: !f.value } : f)),
    );
  }

  toggleDropdown(key: string): void {
    this.openDropdownKey.update(current => (current === key ? null : key));
  }

  selectOption(key: string, option: string): void {
    this.fields.update(fields =>
      fields.map(f => (f.kind === 'select' && f.key === key ? { ...f, value: option } : f)),
    );
    this.openDropdownKey.set(null);
  }

  updateText(key: string, value: string): void {
    this.fields.update(fields =>
      fields.map(f => (f.kind === 'text' && f.key === key ? { ...f, value } : f)),
    );
  }

  save(): void {
    this.showSaved.set(true);
    setTimeout(() => this.showSaved.set(false), 2000);
  }
}
