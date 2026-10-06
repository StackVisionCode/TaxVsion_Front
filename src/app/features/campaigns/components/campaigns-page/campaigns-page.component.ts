import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToastService } from '../../../../shared/ui/toast/toast.service';
import { ModalComponent } from '../../../../shared/ui/modal/modal.component';
import { RichEditorComponent } from '../../ui/rich-editor/rich-editor.component';
import { ChannelPreviewComponent } from '../../ui/channel-preview/channel-preview.component';
import { CampaignsStore } from '../../data-access/campaigns.store';
import { htmlToPlainText } from '../../../mail/data-access/mail.model';
import {
  ApiCampaignStatus,
  ApiChannel,
  CampaignResponse,
  CampaignRunResponse,
  CampaignTemplateResponse,
  CHANNELS,
  ContactResponse,
  RunRecipient,
  campaignStatusClass,
  channelClass,
  runStatusClass,
  unitStateClass,
} from '../../data-access/campaigns.model';

type Tab = 'campaigns' | 'runs' | 'audience' | 'schedules' | 'templates';
const SENDABLE: ApiChannel[] = ['Email', 'Sms', 'Push']; // canales con ejecutor real hoy

/** Metadata de presentación por canal para el wizard de contenido. */
export interface ChannelMeta {
  key: ApiChannel;
  label: string;
  badge: string;
  hasSubject: boolean;
  hasTitle: boolean;
  bodyLabel: string;
  bodyHint: string;
  maxBody: number | null;
}
const CHANNEL_META: ChannelMeta[] = [
  { key: 'Email', label: 'Email', badge: 'EM', hasSubject: true, hasTitle: false, bodyLabel: 'Email body', bodyHint: 'HTML or plain text. Use {{first_name}} for personalization.', maxBody: null },
  { key: 'Sms', label: 'SMS', badge: 'SM', hasSubject: false, hasTitle: false, bodyLabel: 'SMS text', bodyHint: 'Keep it short — 1 SMS ≈ 160 chars.', maxBody: 480 },
  { key: 'Push', label: 'Push', badge: 'PU', hasSubject: false, hasTitle: true, bodyLabel: 'Notification body', bodyHint: 'Shown under the title on the device.', maxBody: 240 },
];

/**
 * Página del módulo Campaigns — orquestador multicanal (servicio `TaxVision.Campaigns`, SIN dinero).
 * Tabs: Campañas / Runs / Audiencia (contactos+listas) / Remitentes / Agendados. Todo cableado al
 * backend real vía {@link CampaignsStore}. Requiere `campaigns.manage` (staff).
 */
@Component({
  selector: 'app-campaigns-page',
  imports: [CommonModule, FormsModule, ModalComponent, RichEditorComponent, ChannelPreviewComponent],
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
  readonly channelMeta = CHANNEL_META;
  metaFor = (ch: ApiChannel): ChannelMeta => CHANNEL_META.find(m => m.key === ch) ?? CHANNEL_META[0];

  /** Paso actual del wizard de crear/editar campaña (1 básicos · 2 contenido · 3 audiencia · 4 revisar). */
  readonly wizardStep = signal(1);
  readonly maxStep = 4;

  /** Variables de personalización disponibles (se sustituyen por los datos del cliente al enviar). */
  readonly campaignVariables = [
    { label: 'First name', token: '{{first_name}}' },
    { label: 'Last name', token: '{{last_name}}' },
    { label: 'Full name', token: '{{full_name}}' },
    { label: 'Email', token: '{{email}}' },
    { label: 'Phone', token: '{{phone}}' },
  ];

  readonly tab = signal<Tab>('campaigns');
  readonly audienceTab = signal<'lists' | 'contacts'>('lists');
  readonly selected = signal<CampaignResponse | null>(null);
  readonly selectedRun = signal<CampaignRunResponse | null>(null);

  readonly statusChips: FilterChipOption<ApiCampaignStatus | 'all'>[] = [
    { id: 'all', label: 'All' },
    { id: 'Draft', label: 'Draft' },
    { id: 'Ready', label: 'Ready' },
    { id: 'Scheduled', label: 'Scheduled' },
    { id: 'Archived', label: 'Archived' },
  ];
  readonly audienceTabs: SegmentedOption<'lists' | 'contacts'>[] = [
    { id: 'lists', label: 'Lists' },
    { id: 'contacts', label: 'Contacts' },
  ];

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
  readonly showMembers = signal(false);
  readonly showEditContact = signal(false);
  readonly showTemplate = signal(false);
  readonly editingTemplateId = signal<string | null>(null);
  readonly busy = signal(false);

  editListForm = { id: '', name: '', description: '' };
  membersList: { id: string; name: string } = { id: '', name: '' };
  memberToAdd = '';
  editContactForm = { id: '', name: '', email: '', phoneE164: '' };
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // ---------- forms ----------
  newForm = this.blankCampaign();
  sendForm = this.blankSend();
  schedForm = this.blankSchedule();
  importForm = { listId: '', csv: 'name,email,phone\n' };
  senderForm = { channel: 'Email' as ApiChannel, name: '', senderRef: '' };
  contactForm = { name: '', email: '', phoneE164: '' };
  templateForm = this.blankTemplate();

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
    if (tab === 'templates') this.store.loadCampaignTemplates();
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

  /** Listas con al menos un miembro — las únicas que tiene sentido ofrecer como audiencia de envío. */
  readonly nonEmptyLists = computed(() => this.store.lists().filter(l => l.memberCount > 0));

  // ---------- list members (edición de audiencia) ----------
  /** Contactos que NO están ya en la lista abierta — opciones del selector para agregar. */
  readonly addableContacts = computed(() => {
    const memberIds = new Set(this.store.listMembers().map(m => m.id));
    return this.store.contacts().filter(c => !memberIds.has(c.id));
  });

  openMembers(l: { id: string; name: string }): void {
    this.membersList = { id: l.id, name: l.name };
    this.memberToAdd = '';
    this.store.loadContacts(); // asegura el catálogo para el selector
    this.store.loadListMembers(l.id);
    this.showMembers.set(true);
  }
  addMemberToList(): void {
    if (!this.memberToAdd) return;
    this.busy.set(true);
    this.store.addListMember(this.membersList.id, this.memberToAdd).subscribe({
      next: () => {
        this.memberToAdd = '';
        this.busy.set(false);
      },
      error: () => {
        this.toast.error(this.store.actionError() ?? 'Could not add the contact.');
        this.busy.set(false);
      },
    });
  }
  removeMemberFromList(contactId: string): void {
    this.store.removeListMember(this.membersList.id, contactId).subscribe({
      next: () => this.toast.success('Removed from the list.'),
      error: () => this.toast.error(this.store.actionError() ?? 'Could not remove the contact.'),
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

  // ---------- new campaign (wizard) ----------
  private blankContent() {
    return {
      Email: { subject: '', title: '', body: '' },
      Sms: { subject: '', title: '', body: '' },
      Push: { subject: '', title: '', body: '' },
    } as Record<string, { subject: string; title: string; body: string }>;
  }
  private blankCampaign() {
    return {
      name: '',
      channels: { Email: true, Sms: false, Push: false } as Record<string, boolean>,
      /** Modo contenido único: un solo texto que se adapta a cada canal (default), vs por canal. */
      unified: true,
      shared: { subject: '', title: '', body: '' },
      content: this.blankContent(),
      templateId: '',
      listIds: {} as Record<string, boolean>,
      includeCustomers: false,
    };
  }

  /** Deriva el contenido de un canal desde el contenido único (Email HTML, SMS/Push texto plano). */
  unifiedDerive(ch: ApiChannel): { subject: string; title: string; body: string } {
    const s = this.newForm.shared;
    const plain = htmlToPlainText(s.body);
    if (ch === 'Email') return { subject: s.subject, title: '', body: s.body };
    if (ch === 'Push') return { subject: '', title: s.subject || s.title, body: plain };
    return { subject: '', title: '', body: plain }; // SMS / WhatsApp / InApp
  }
  /** Contenido efectivo de un canal (según el modo), para preview y payload. */
  effectiveContent(ch: ApiChannel): { subject: string; title: string; body: string } {
    return this.newForm.unified ? this.unifiedDerive(ch) : this.newForm.content[ch];
  }
  openNew(): void {
    this.editingId.set(null);
    this.newForm = this.blankCampaign();
    this.wizardStep.set(1);
    this.store.loadTemplates();
    this.store.loadCampaignTemplates();
    this.showNew.set(true);
  }
  openEditCampaign(c: CampaignResponse): void {
    this.editingId.set(c.id);
    const form = this.blankCampaign();
    form.name = c.name;
    form.channels = {
      Email: c.channels.includes('Email'),
      Sms: c.channels.includes('Sms'),
      Push: c.channels.includes('Push'),
    };
    // Carga el contenido por canal; si la campaña es vieja (solo message/subject), lo siembra en Email.
    for (const ch of this.sendable) {
      const found = c.contents?.find(x => x.channel === ch);
      if (found) form.content[ch] = { subject: found.subject ?? '', title: found.title ?? '', body: found.body };
    }
    if (!c.contents?.some(x => x.channel === 'Email') && c.channels.includes('Email')) {
      form.content['Email'] = { subject: c.subject ?? '', title: '', body: c.message };
    }
    form.unified = false; // editar una campaña existente entra en modo por-canal
    this.newForm = form;
    this.wizardStep.set(1);
    this.store.loadTemplates();
    this.showNew.set(true);
  }

  // ----- wizard navigation + validation -----
  selectedChannels(): ApiChannel[] {
    return this.sendable.filter(c => this.newForm.channels[c]);
  }
  step1Valid(): boolean {
    return !!this.newForm.name.trim() && this.selectedChannels().length > 0;
  }
  step2Valid(): boolean {
    if (this.newForm.unified) return this.newForm.shared.body.trim().length > 0;
    return this.selectedChannels().every(ch => this.newForm.content[ch].body.trim().length > 0);
  }
  /** Último paso del wizard: editar = 2 (Basics, Content); crear = 3 (Basics, Content, Review). */
  lastStep(): number {
    return this.editingId() ? 2 : 3;
  }
  wizardNext(): void {
    const s = this.wizardStep();
    if (s === 1 && !this.step1Valid()) {
      this.toast.error('Add a name and pick at least one channel.');
      return;
    }
    if (s === 2 && !this.step2Valid()) {
      this.toast.error('Each selected channel needs its content.');
      return;
    }
    this.wizardStep.set(Math.min(s + 1, this.lastStep()));
  }
  wizardBack(): void {
    this.wizardStep.set(Math.max(this.wizardStep() - 1, 1));
  }
  /** Ir a un paso: hacia atrás libre; hacia adelante solo si los previos son válidos. */
  goStep(n: number): void {
    if (n <= this.wizardStep()) {
      this.wizardStep.set(n);
      return;
    }
    if (n >= 2 && !this.step1Valid()) return;
    if (n >= 3 && !this.step2Valid()) return;
    this.wizardStep.set(n);
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
  /** Aplica un template (hoy email-only de Notification) al contenido del canal Email. */
  applyTemplate(id: string): void {
    this.newForm.templateId = id;
    const t = this.store.templates().find(x => x.id === id);
    if (!t) return;
    const target = this.newForm.unified ? this.newForm.shared : this.newForm.content['Email'];
    if (t.subject) target.subject = t.subject;
    const base = [t.subject, t.description].filter(Boolean).join(' — ');
    if (base && !target.body.trim()) target.body = base;
  }
  /** Contador de caracteres para canales con límite (SMS/Push), según el contenido efectivo. */
  bodyLen(ch: ApiChannel): number {
    return this.effectiveContent(ch)?.body.length ?? 0;
  }
  /** Arma el payload create/update desde el wizard: contenido por canal + base de compatibilidad. */
  private buildCampaignPayload() {
    const channels = this.selectedChannels();
    const contents = channels.map(ch => {
      const m = this.metaFor(ch);
      const c = this.effectiveContent(ch);
      return {
        channel: ch,
        subject: m.hasSubject ? c.subject.trim() || null : null,
        title: m.hasTitle ? c.title.trim() || null : null,
        body: c.body.trim(),
      };
    });
    // El backend exige Message base no vacío: usa Email si está, si no el primer canal.
    const base = contents.find(x => x.channel === 'Email') ?? contents[0];
    const emailSubject = contents.find(x => x.channel === 'Email')?.subject || null;
    return { name: this.newForm.name.trim(), channels, message: base.body, subject: emailSubject, contents };
  }

  /** Crea (borrador) o actualiza la campaña. El ENVÍO a la audiencia es un paso aparte (botón Send). */
  submitNew(): void {
    if (!this.step1Valid()) {
      this.toast.error('Add a name and pick at least one channel.');
      this.wizardStep.set(1);
      return;
    }
    if (!this.step2Valid()) {
      this.toast.error('Each selected channel needs its content.');
      this.wizardStep.set(2);
      return;
    }
    const payload = this.buildCampaignPayload();
    const editing = this.editingId();
    this.busy.set(true);

    const op = editing ? this.store.updateCampaign(editing, payload) : this.store.createCampaign(payload);
    op.subscribe({
      next: () => {
        this.toast.success(editing ? 'Campaign updated.' : 'Campaign saved as Draft. Use “Send” to pick an audience.');
        this.showNew.set(false);
        this.editingId.set(null);
        this.busy.set(false);
      },
      error: () => {
        this.toast.error(this.store.actionError() ?? 'Could not save the campaign.');
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
    // Guard anti re-envío accidental: cada Send dispara un envío real a toda la audiencia.
    if (!confirm(`Send “${c.name}” now across ${c.channels.join(', ')}? Each recipient gets one message per channel. This cannot be undone.`))
      return;
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
  readonly importDragging = signal(false);
  readonly importFileName = signal<string | null>(null);
  /** Filas de datos en el CSV pegado/subido (sin encabezado ni líneas vacías) — para el preview. */
  readonly importRowCount = computed(() => {
    const lines = this.importForm.csv.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return 0;
    const first = lines[0].toLowerCase();
    const hasHeader = first.includes('email') || first.includes('name') || first.includes('phone') || first.includes('tel');
    return Math.max(0, lines.length - (hasHeader ? 1 : 0));
  });

  openImport(listId?: string): void {
    this.importForm = { listId: listId ?? this.store.lists()[0]?.id ?? '', csv: 'name,email,phone\n' };
    this.importFileName.set(null);
    this.importDragging.set(false);
    this.showImport.set(true);
  }
  onImportDragOver(e: DragEvent): void {
    e.preventDefault();
    this.importDragging.set(true);
  }
  onImportDragLeave(e: DragEvent): void {
    e.preventDefault();
    this.importDragging.set(false);
  }
  onImportDrop(e: DragEvent): void {
    e.preventDefault();
    this.importDragging.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) this.acceptImportFile(f);
  }
  onImportFileInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) this.acceptImportFile(f);
    input.value = '';
  }
  clearImportFile(): void {
    this.importFileName.set(null);
    this.importForm.csv = 'name,email,phone\n';
  }
  private acceptImportFile(file: File): void {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
      this.toast.error('Solo se admiten archivos .csv.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.importForm.csv = String(reader.result ?? '');
      this.importFileName.set(file.name);
    };
    reader.onerror = () => this.toast.error('No se pudo leer el archivo.');
    reader.readAsText(file);
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
        // Etapa C — resumen de clientes creados en el directorio Customer.
        if (r.customerPermissionDenied) {
          this.toast.error('Los contactos se importaron, pero no tienes permiso (customers.manage) para crearlos como clientes.');
        } else {
          const cust = r.customersCreated + r.customersExisting + r.customersFailed;
          if (cust > 0 || r.customersSkippedNoEmail > 0) {
            const parts = [`${r.customersCreated} nuevos`, `${r.customersExisting} ya existían`];
            if (r.customersSkippedNoEmail > 0) parts.push(`${r.customersSkippedNoEmail} sin email`);
            if (r.customersFailed > 0) parts.push(`${r.customersFailed} fallaron`);
            this.toast.success(`Clientes · ${parts.join(', ')}.`);
          }
        }
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
    return parseUtcDateOrNull(s);
  }

  /** Clases de color de las píldoras de campaigns (sin borde visible, en negrita) sobre `app-status-pill`. */
  pill(colorClass: string): string {
    return `${colorClass} border-transparent font-bold`;
  }

  settled(r: CampaignRunResponse): number {
    return r.delivered + r.failed + r.skipped + r.unknown;
  }
  pct(part: number, total: number): number {
    return total > 0 ? Math.round((part / total) * 100) : 0;
  }
  // ---------- campaign templates (gestor) ----------
  private blankTemplate() {
    return {
      name: '',
      description: '',
      channels: { Email: true, Sms: false, Push: false } as Record<string, boolean>,
      content: this.blankContent(),
    };
  }
  templateChannels(): ApiChannel[] {
    return this.sendable.filter(c => this.templateForm.channels[c]);
  }
  toggleTemplateChannel(c: ApiChannel): void {
    this.templateForm.channels[c] = !this.templateForm.channels[c];
  }
  templateBodyLen(ch: ApiChannel): number {
    return this.templateForm.content[ch]?.body.length ?? 0;
  }
  openNewTemplate(): void {
    this.editingTemplateId.set(null);
    this.templateForm = this.blankTemplate();
    this.showTemplate.set(true);
  }
  openEditTemplate(t: CampaignTemplateResponse): void {
    this.editingTemplateId.set(t.id);
    const form = this.blankTemplate();
    form.name = t.name;
    form.description = t.description ?? '';
    form.channels = {
      Email: t.channels.includes('Email'),
      Sms: t.channels.includes('Sms'),
      Push: t.channels.includes('Push'),
    };
    for (const ch of this.sendable) {
      const found = t.contents?.find(x => x.channel === ch);
      if (found) form.content[ch] = { subject: found.subject ?? '', title: found.title ?? '', body: found.body };
    }
    this.templateForm = form;
    this.showTemplate.set(true);
  }
  submitTemplate(): void {
    const channels = this.templateChannels();
    if (!this.templateForm.name.trim() || channels.length === 0) {
      this.toast.error('Name and at least one channel are required.');
      return;
    }
    if (!channels.every(ch => this.templateForm.content[ch].body.trim().length > 0)) {
      this.toast.error('Each selected channel needs content.');
      return;
    }
    const contents = channels.map(ch => {
      const m = this.metaFor(ch);
      const c = this.templateForm.content[ch];
      return {
        channel: ch,
        subject: m.hasSubject ? c.subject.trim() || null : null,
        title: m.hasTitle ? c.title.trim() || null : null,
        body: c.body.trim(),
      };
    });
    const req = {
      name: this.templateForm.name.trim(),
      description: this.templateForm.description.trim() || null,
      channels,
      contents,
    };
    const editing = this.editingTemplateId();
    this.busy.set(true);
    const op = editing ? this.store.updateCampaignTemplate(editing, req) : this.store.createCampaignTemplate(req);
    op.subscribe({
      next: () => {
        this.toast.success(editing ? 'Template updated.' : 'Template created.');
        this.showTemplate.set(false);
        this.editingTemplateId.set(null);
        this.busy.set(false);
      },
      error: () => {
        this.toast.error(this.store.actionError() ?? 'Could not save the template.');
        this.busy.set(false);
      },
    });
  }
  removeTemplate(t: CampaignTemplateResponse): void {
    if (!confirm(`Delete template “${t.name}”?`)) return;
    this.store.deleteCampaignTemplate(t.id).subscribe({
      next: () => this.toast.success('Template deleted.'),
      error: () => this.toast.error(this.store.actionError() ?? 'Could not delete the template.'),
    });
  }
  /** Wizard: carga una plantilla de campaña en el contenido (pasa a modo por-canal). */
  applyCampaignTemplate(id: string): void {
    if (!id) return;
    const t = this.store.campaignTemplates().find(x => x.id === id);
    if (!t) return;
    this.newForm.unified = false;
    this.newForm.channels = {
      Email: t.channels.includes('Email'),
      Sms: t.channels.includes('Sms'),
      Push: t.channels.includes('Push'),
    };
    this.newForm.content = this.blankContent();
    for (const ch of this.sendable) {
      const found = t.contents?.find(x => x.channel === ch);
      if (found) this.newForm.content[ch] = { subject: found.subject ?? '', title: found.title ?? '', body: found.body };
    }
    this.toast.success(`Loaded template “${t.name}”.`);
  }
  /** Wizard: guarda el contenido actual como plantilla reutilizable. */
  saveAsTemplate(): void {
    const channels = this.selectedChannels();
    if (channels.length === 0 || !this.step2Valid()) {
      this.toast.error('Pick channels and write the content first.');
      return;
    }
    const name = window.prompt('Template name');
    if (!name?.trim()) return;
    const contents = channels
      .map(ch => {
        const m = this.metaFor(ch);
        const c = this.effectiveContent(ch);
        return {
          channel: ch,
          subject: m.hasSubject ? c.subject.trim() || null : null,
          title: m.hasTitle ? c.title.trim() || null : null,
          body: c.body.trim(),
        };
      })
      .filter(x => x.body.length > 0);
    this.store.createCampaignTemplate({ name: name.trim(), channels, contents }).subscribe({
      next: () => this.toast.success(`Saved as template “${name.trim()}”.`),
      error: () => this.toast.error(this.store.actionError() ?? 'Could not save the template.'),
    });
  }

  trackById = (_: number, x: { id: string }) => x.id;
}
