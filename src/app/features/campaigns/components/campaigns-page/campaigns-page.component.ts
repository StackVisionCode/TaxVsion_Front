import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToastService } from '../../../../shared/ui/toast/toast.service';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { CampaignsStore } from '../../data-access/campaigns.store';
import {
  ApiCampaignStatus,
  ApiChannel,
  CampaignResponse,
  CampaignRunResponse,
  CHANNELS,
  ContactResponse,
  RunRecipient,
  campaignStatusClass,
  channelClass,
  runStatusClass,
  unitStateClass,
} from '../../data-access/campaigns.model';

type Tab = 'campaigns' | 'runs' | 'audience' | 'senders' | 'schedules';
const SENDABLE: ApiChannel[] = ['Email', 'Sms', 'Push']; // canales con ejecutor real hoy

/**
 * Página del módulo Campaigns — orquestador multicanal (servicio `TaxVision.Campaigns`, SIN dinero).
 * Tabs: Campañas / Runs / Audiencia (contactos+listas) / Remitentes / Agendados. Todo cableado al
 * backend real vía {@link CampaignsStore}. Requiere `campaigns.manage` (staff).
 */
@Component({
  selector: 'app-campaigns-page',
  imports: [CommonModule, FormsModule, ModalComponent],
  templateUrl: './campaigns-page.component.html',
})
export class CampaignsPageComponent implements OnInit, OnDestroy {
  readonly store = inject(CampaignsStore);
  private readonly toast = inject(ToastService);

  // view helpers (usados en el template)
  readonly channelClass = channelClass;
  readonly campaignStatusClass = campaignStatusClass;
  readonly runStatusClass = runStatusClass;
  readonly unitStateClass = unitStateClass;
  readonly allChannels = CHANNELS;
  readonly sendable = SENDABLE;

  readonly tab = signal<Tab>('campaigns');
  readonly audienceTab = signal<'lists' | 'contacts'>('lists');
  readonly selected = signal<CampaignResponse | null>(null);
  readonly selectedRun = signal<CampaignRunResponse | null>(null);

  readonly statusChips: (ApiCampaignStatus | 'all')[] = ['all', 'Draft', 'Ready', 'Scheduled', 'Archived'];

  // ---------- modals ----------
  readonly showNew = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly showSend = signal(false);
  readonly showSchedule = signal(false);
  readonly showImport = signal(false);
  readonly showSender = signal(false);
  readonly showContact = signal(false);
  readonly showRun = signal(false);
  readonly showEditList = signal(false);
  readonly showEditContact = signal(false);
  readonly busy = signal(false);

  editListForm = { id: '', name: '', description: '' };
  editContactForm = { id: '', name: '', email: '', phoneE164: '' };
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // ---------- forms ----------
  newForm = this.blankCampaign();
  sendForm = this.blankSend();
  schedForm = this.blankSchedule();
  importForm = { listId: '', csv: 'name,email,phone\n' };
  senderForm = { channel: 'Email' as ApiChannel, name: '', senderRef: '' };
  contactForm = { name: '', email: '', phoneE164: '' };

  // aggregate stats (client-side, from what is loaded)
  readonly activeCount = computed(() => this.store.campaigns().filter(c => c.status !== 'Archived').length);
  readonly audienceSize = computed(
    () => this.store.lists().reduce((a, l) => a + l.memberCount, 0) + this.store.contacts().length,
  );

  ngOnInit(): void {
    this.store.init();
  }
  ngOnDestroy(): void {
    this.stopPolling();
  }

  /** Auto-refresh de runs mientras haya alguno Dispatching (efecto "live" sin socket). */
  private startPolling(campaignId: string): void {
    this.stopPolling();
    let ticks = 0;
    this.pollTimer = setInterval(() => {
      ticks++;
      this.store.loadRuns(campaignId);
      const anyDispatching = this.store.runs().some(r => r.status === 'Dispatching');
      if (!anyDispatching || ticks >= 15) this.stopPolling();
    }, 4000);
  }
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Estado "honesto" derivado de contadores (un run cerrado en Accepted puede quedar Failed por DLR tardío). */
  displayOutcome(r: CampaignRunResponse): { label: string; cls: string } {
    if (r.status === 'Dispatching') return { label: 'Dispatching', cls: runStatusClass('Dispatching') };
    const good = r.delivered + r.accepted;
    if (good === 0 && r.failed + r.unknown > 0) return { label: 'Failed', cls: runStatusClass('Failed') };
    if (r.failed + r.unknown > 0) return { label: 'Partially failed', cls: runStatusClass('PartiallyFailed') };
    return { label: 'Completed', cls: runStatusClass('Completed') };
  }

  // ---------- tabs ----------
  go(tab: Tab): void {
    this.tab.set(tab);
    if (tab === 'audience') this.store.loadContacts();
    if (tab === 'runs' && this.selected()) this.store.loadRuns(this.selected()!.id);
    if (tab === 'schedules' && this.selected()) this.store.loadSchedules(this.selected()!.id);
  }

  pickCampaign(c: CampaignResponse): void {
    this.selected.set(c);
    this.store.loadRuns(c.id);
    this.store.loadSchedules(c.id);
    this.tab.set('runs');
    this.startPolling(c.id);
  }

  // ---------- contact list edit / delete ----------
  openEditList(l: { id: string; name: string; description: string | null }): void {
    this.editListForm = { id: l.id, name: l.name, description: l.description ?? '' };
    this.showEditList.set(true);
  }
  submitEditList(): void {
    if (!this.editListForm.name.trim()) {
      this.toast.error('Name is required.');
      return;
    }
    this.busy.set(true);
    this.store.updateContactList(this.editListForm.id, { name: this.editListForm.name.trim(), description: this.editListForm.description.trim() || null }).subscribe({
      next: () => {
        this.toast.success('List updated.');
        this.showEditList.set(false);
        this.busy.set(false);
      },
      error: () => {
        this.toast.error(this.store.actionError() ?? 'Could not update the list.');
        this.busy.set(false);
      },
    });
  }
  deleteList(l: { id: string; name: string }): void {
    if (!confirm(`Delete list “${l.name}”? Its memberships are removed (contacts stay).`)) return;
    this.store.deleteContactList(l.id).subscribe({
      next: () => this.toast.success('List deleted.'),
      error: () => this.toast.error(this.store.actionError() ?? 'Could not delete the list.'),
    });
  }

  // ---------- contact edit / delete ----------
  openEditContact(c: ContactResponse): void {
    this.editContactForm = { id: c.id, name: c.name ?? '', email: c.email ?? '', phoneE164: c.phoneE164 ?? '' };
    this.showEditContact.set(true);
  }
  submitEditContact(): void {
    if (!this.editContactForm.email.trim() && !this.editContactForm.phoneE164.trim()) {
      this.toast.error('A contact needs an email or a phone.');
      return;
    }
    this.busy.set(true);
    this.store.updateContact(this.editContactForm.id, {
      name: this.editContactForm.name.trim() || null,
      email: this.editContactForm.email.trim() || null,
      phoneE164: this.editContactForm.phoneE164.trim() || null,
    }).subscribe({
      next: () => {
        this.toast.success('Contact updated.');
        this.showEditContact.set(false);
        this.busy.set(false);
      },
      error: () => {
        this.toast.error(this.store.actionError() ?? 'Could not update the contact.');
        this.busy.set(false);
      },
    });
  }
  removeContact(c: ContactResponse): void {
    if (!confirm(`Delete contact “${c.name ?? c.email ?? c.phoneE164}”?`)) return;
    this.store.deleteContact(c.id).subscribe({
      next: () => this.toast.success('Contact deleted.'),
      error: () => this.toast.error(this.store.actionError() ?? 'Could not delete the contact.'),
    });
  }

  // ---------- new campaign ----------
  private blankCampaign() {
    return {
      name: '',
      subject: '',
      message: '',
      channels: { Email: true, Sms: true } as Record<string, boolean>,
      templateId: '',
      listIds: {} as Record<string, boolean>,
      includeCustomers: false,
    };
  }
  openNew(): void {
    this.editingId.set(null);
    this.newForm = this.blankCampaign();
    this.store.loadTemplates();
    this.showNew.set(true);
  }
  openEditCampaign(c: CampaignResponse): void {
    this.editingId.set(c.id);
    this.newForm = {
      ...this.blankCampaign(),
      name: c.name,
      subject: c.subject ?? '',
      message: c.message,
      channels: { Email: c.channels.includes('Email'), Sms: c.channels.includes('Sms') },
    };
    this.store.loadTemplates();
    this.showNew.set(true);
  }
  markReady(c: CampaignResponse): void {
    this.store.markReady(c.id).subscribe({
      next: () => this.toast.success('Campaign marked Ready.'),
      error: () => this.toast.error(this.store.actionError() ?? 'Could not mark ready.'),
    });
  }
  revertToDraft(c: CampaignResponse): void {
    this.store.revertToDraft(c.id).subscribe({
      next: () => this.toast.success('Campaign back to Draft — you can edit it now.'),
      error: () => this.toast.error(this.store.actionError() ?? 'Could not revert.'),
    });
  }
  archiveCampaign(c: CampaignResponse): void {
    if (!confirm(`Archive “${c.name}”? It can no longer be edited or sent.`)) return;
    this.store.archiveCampaign(c.id).subscribe({
      next: () => this.toast.success('Campaign archived.'),
      error: () => this.toast.error(this.store.actionError() ?? 'Could not archive.'),
    });
  }
  deleteCampaign(c: CampaignResponse): void {
    if (!confirm(`Delete “${c.name}” permanently? Its run history stays but the campaign is gone.`)) return;
    if (this.selected()?.id === c.id) this.selected.set(null);
    this.store.deleteCampaign(c.id).subscribe({
      next: () => this.toast.success('Campaign deleted.'),
      error: () => this.toast.error(this.store.actionError() ?? 'Could not delete.'),
    });
  }
  /** Destino legible SEGÚN el canal: Email→email, SMS/WhatsApp→teléfono. Cae al contactRef si falta. */
  destinationOf(u: RunRecipient): string {
    if (u.channel === 'Email') return u.email || '(no email)';
    if (u.channel === 'Sms' || u.channel === 'WhatsApp') return u.phoneE164 || '(no phone)';
    return u.email || u.phoneE164 || u.contactRef;
  }
  toggleNewChannel(c: ApiChannel): void {
    this.newForm.channels[c] = !this.newForm.channels[c];
  }
  /** El body "obtiene" un template: precarga asunto + una base editable (el HTML real lo renderiza el canal). */
  applyTemplate(id: string): void {
    this.newForm.templateId = id;
    const t = this.store.templates().find(x => x.id === id);
    if (!t) return;
    if (t.subject) this.newForm.subject = t.subject;
    const base = [t.subject, t.description].filter(Boolean).join(' — ');
    if (base && !this.newForm.message.trim()) this.newForm.message = base;
  }
  submitNew(sendAfter: boolean): void {
    const channels = this.sendable.filter(c => this.newForm.channels[c]);
    if (!this.newForm.name.trim() || channels.length === 0 || !this.newForm.message.trim()) {
      this.toast.error('Name, at least one channel and a message are required.');
      return;
    }

    // Edición de una campaña existente (Draft): actualiza y cierra, sin enviar.
    const editing = this.editingId();
    if (editing) {
      this.busy.set(true);
      this.store
        .updateCampaign(editing, { name: this.newForm.name.trim(), channels, message: this.newForm.message.trim(), subject: this.newForm.subject.trim() || null })
        .subscribe({
          next: () => {
            this.toast.success('Campaign updated.');
            this.showNew.set(false);
            this.editingId.set(null);
            this.busy.set(false);
          },
          error: () => {
            this.toast.error(this.store.actionError() ?? 'Could not update the campaign.');
            this.busy.set(false);
          },
        });
      return;
    }

    const listIds = Object.keys(this.newForm.listIds).filter(id => this.newForm.listIds[id]);
    if (sendAfter && listIds.length === 0 && !this.newForm.includeCustomers) {
      this.toast.error('Pick a contact list (or clients) to send to.');
      return;
    }
    this.busy.set(true);
    this.store
      .createCampaign({ name: this.newForm.name.trim(), channels, message: this.newForm.message.trim(), subject: this.newForm.subject.trim() || null })
      .subscribe({
        next: created => {
          if (!sendAfter) {
            this.toast.success('Campaign created as Draft.');
            this.showNew.set(false);
            this.busy.set(false);
            return;
          }
          this.selected.set(created);
          this.store.sendToAudience(created.id, { contactListIds: listIds, includeCustomers: this.newForm.includeCustomers, manual: [] }).subscribe({
            next: run => {
              this.toast.success(`Campaign created · run started (${run.recipientCount} units).`);
              this.showNew.set(false);
              this.busy.set(false);
              this.tab.set('runs');
              this.startPolling(created.id);
            },
            error: () => {
              this.toast.error(this.store.actionError() ?? 'Created, but the send failed.');
              this.busy.set(false);
            },
          });
        },
        error: () => {
          this.toast.error(this.store.actionError() ?? 'Could not create the campaign.');
          this.busy.set(false);
        },
      });
  }

  // ---------- send to audience ----------
  private blankSend() {
    return { listIds: {} as Record<string, boolean>, includeCustomers: false, manual: '' };
  }
  openSend(c: CampaignResponse): void {
    this.selected.set(c);
    this.sendForm = this.blankSend();
    this.showSend.set(true);
  }
  toggleList(id: string): void {
    this.sendForm.listIds[id] = !this.sendForm.listIds[id];
  }
  submitSend(): void {
    const c = this.selected();
    if (!c) return;
    const contactListIds = Object.keys(this.sendForm.listIds).filter(id => this.sendForm.listIds[id]);
    const manual = this.sendForm.manual
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(v => (v.includes('@') ? { email: v } : { phoneE164: v }));
    if (contactListIds.length === 0 && manual.length === 0 && !this.sendForm.includeCustomers) {
      this.toast.error('Pick at least one audience source.');
      return;
    }
    this.busy.set(true);
    this.store.sendToAudience(c.id, { contactListIds, manual, includeCustomers: this.sendForm.includeCustomers }).subscribe({
      next: run => {
        this.toast.success(`Run started · ${run.recipientCount} units dispatching.`);
        this.showSend.set(false);
        this.busy.set(false);
        this.tab.set('runs');
        this.startPolling(c.id);
      },
      error: () => {
        this.toast.error(this.store.actionError() ?? 'Could not start the run.');
        this.busy.set(false);
      },
    });
  }

  // ---------- schedule ----------
  private blankSchedule() {
    return { recurring: false, runAt: '', intervalMinutes: 1440, listIds: {} as Record<string, boolean>, includeCustomers: false };
  }
  openSchedule(c: CampaignResponse): void {
    this.selected.set(c);
    this.schedForm = this.blankSchedule();
    this.showSchedule.set(true);
  }
  submitSchedule(): void {
    const c = this.selected();
    if (!c || !this.schedForm.runAt) {
      this.toast.error('Pick a first-run date/time.');
      return;
    }
    const contactListIds = Object.keys(this.schedForm.listIds).filter(id => this.schedForm.listIds[id]);
    this.busy.set(true);
    this.store
      .schedule(c.id, {
        recurring: this.schedForm.recurring,
        runAtUtc: new Date(this.schedForm.runAt).toISOString(),
        intervalMinutes: this.schedForm.recurring ? this.schedForm.intervalMinutes : null,
        contactListIds,
        includeCustomers: this.schedForm.includeCustomers,
      })
      .subscribe({
        next: () => {
          this.toast.success('Campaign scheduled.');
          this.showSchedule.set(false);
          this.busy.set(false);
          this.tab.set('schedules');
        },
        error: () => {
          this.toast.error(this.store.actionError() ?? 'Could not schedule the campaign.');
          this.busy.set(false);
        },
      });
  }
  scheduleAction(scheduleId: string, action: 'pause' | 'resume' | 'cancel'): void {
    const c = this.selected();
    if (!c) return;
    this.store.setScheduleState(c.id, scheduleId, action).subscribe({
      next: () => this.toast.success(`Schedule ${action}d.`),
      error: () => this.toast.error(this.store.actionError() ?? 'Action failed.'),
    });
  }

  // ---------- import ----------
  openImport(listId?: string): void {
    this.importForm = { listId: listId ?? this.store.lists()[0]?.id ?? '', csv: 'name,email,phone\n' };
    this.showImport.set(true);
  }
  submitImport(): void {
    if (!this.importForm.listId) {
      this.toast.error('Pick a target list.');
      return;
    }
    this.busy.set(true);
    this.store.importContacts(this.importForm.listId, { csv: this.importForm.csv }).subscribe({
      next: r => {
        this.toast.success(`Imported · ${r.created} created, ${r.reused} reused, ${r.invalid} skipped.`);
        this.showImport.set(false);
        this.busy.set(false);
      },
      error: () => {
        this.toast.error(this.store.actionError() ?? 'Import failed.');
        this.busy.set(false);
      },
    });
  }

  // ---------- list / contact / sender quick-creates ----------
  createList(name: string): void {
    if (!name.trim()) return;
    this.store.createContactList({ name: name.trim() }).subscribe({
      next: () => this.toast.success('List created.'),
      error: () => this.toast.error(this.store.actionError() ?? 'Could not create the list.'),
    });
  }
  openContact(): void {
    this.contactForm = { name: '', email: '', phoneE164: '' };
    this.showContact.set(true);
  }
  submitContact(): void {
    if (!this.contactForm.email.trim() && !this.contactForm.phoneE164.trim()) {
      this.toast.error('A contact needs an email or a phone.');
      return;
    }
    this.busy.set(true);
    this.store
      .createContact({ name: this.contactForm.name.trim() || null, email: this.contactForm.email.trim() || null, phoneE164: this.contactForm.phoneE164.trim() || null })
      .subscribe({
        next: () => {
          this.toast.success('Contact created.');
          this.showContact.set(false);
          this.busy.set(false);
        },
        error: () => {
          this.toast.error(this.store.actionError() ?? 'Could not create the contact.');
          this.busy.set(false);
        },
      });
  }
  toggleOptOut(contact: ContactResponse, channel: ApiChannel): void {
    const optedOut = !contact.optedOutChannels.includes(channel);
    this.store.setContactOptOut(contact.id, { channels: [channel], optedOut }).subscribe({
      next: () => this.toast.success(`${channel} ${optedOut ? 'opted out' : 'opted in'} for ${contact.name ?? contact.email ?? 'contact'}.`),
      error: () => this.toast.error(this.store.actionError() ?? 'Action failed.'),
    });
  }

  openSender(): void {
    this.senderForm = { channel: 'Email', name: '', senderRef: '' };
    this.showSender.set(true);
  }
  submitSender(): void {
    if (!this.senderForm.name.trim() || !this.senderForm.senderRef.trim()) {
      this.toast.error('Name and sender reference are required.');
      return;
    }
    this.busy.set(true);
    this.store.createSender({ channel: this.senderForm.channel, name: this.senderForm.name.trim(), senderRef: this.senderForm.senderRef.trim() }).subscribe({
      next: () => {
        this.toast.success('Sender profile created.');
        this.showSender.set(false);
        this.busy.set(false);
      },
      error: () => {
        this.toast.error(this.store.actionError() ?? 'Could not create the sender.');
        this.busy.set(false);
      },
    });
  }
  toggleSender(id: string, active: boolean): void {
    this.store.setSenderStatus(id, active).subscribe({
      next: () => this.toast.success(active ? 'Sender enabled.' : 'Sender disabled.'),
      error: () => this.toast.error(this.store.actionError() ?? 'Action failed.'),
    });
  }

  // ---------- run detail ----------
  openRun(run: CampaignRunResponse): void {
    this.selectedRun.set(run);
    this.showRun.set(true);
  }

  // ---------- misc ----------
  /**
   * Interpreta una fecha del backend como UTC y devuelve un Date (el pipe `date` la muestra en local).
   * Necesario porque las fechas cargadas de EF vienen SIN sufijo 'Z' → Angular las tomaría como local.
   */
  local(s: string | null | undefined): Date | null {
    if (!s) return null;
    const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  settled(r: CampaignRunResponse): number {
    return r.delivered + r.failed + r.skipped + r.unknown;
  }
  pct(part: number, total: number): number {
    return total > 0 ? Math.round((part / total) * 100) : 0;
  }
  trackById = (_: number, x: { id: string }) => x.id;
}
