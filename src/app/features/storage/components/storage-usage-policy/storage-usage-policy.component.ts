import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';

type StorageMode = 'crm' | 'primary' | 'both' | 'backup';
type BackupFrequency = 'daily' | 'weekly' | 'monthly';
interface StoragePolicy {
  providerId: string;
  availableProviders: string[];
  mode: StorageMode;
  backupFrequency: BackupFrequency | null;
  backupTime: string | null;
  backupTimeZoneId: string | null;
}

@Component({
  selector: 'app-storage-usage-policy',
  imports: [CommonModule],
  template: `
    <section class="border-t border-gray-100 pt-5" aria-labelledby="storage-policy-title">
      <h3 id="storage-policy-title" class="text-base font-semibold text-gray-900">How should the CRM use this cloud provider?</h3>
      <p class="mt-1 text-sm text-gray-500">Choose the behavior before connecting. Connecting does not move existing files.</p>

      <label class="mt-4 block max-w-sm text-sm font-medium text-gray-700">Cloud provider for these settings
        <select class="mt-1.5 block w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-bold focus:outline-none focus:ring-2 focus:ring-brand-bold/20"
          [value]="providerId()" [disabled]="loading() || saving()" (change)="selectProvider($any($event.target).value)">
          <option value="google-drive">Google Drive</option><option value="onedrive">OneDrive</option><option value="dropbox">Dropbox</option>
        </select>
      </label>

      @if (loading()) {
        <div class="mt-4 h-24 animate-pulse rounded-2xl bg-gray-100" aria-label="Loading storage policy"></div>
      } @else {
        <div class="mt-4 grid gap-3 lg:grid-cols-2" role="radiogroup" aria-label="Cloud storage usage mode">
          @for (option of modeOptions; track option.id) {
            <button type="button" role="radio" [attr.aria-checked]="mode() === option.id"
              [disabled]="saving()" (click)="selectMode(option.id)"
              class="rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bold"
              [class.border-brand-bold]="mode() === option.id" [class.bg-indigo-50]="mode() === option.id"
              [class.border-gray-200]="mode() !== option.id" [class.bg-white]="mode() !== option.id">
              <span class="flex items-start gap-3">
                <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border"
                  [class.border-brand-bold]="mode() === option.id" [class.border-gray-300]="mode() !== option.id">
                  @if (mode() === option.id) { <span class="size-2.5 rounded-full bg-brand-bold"></span> }
                </span>
                <span>
                  <span class="block text-sm font-semibold text-gray-900">{{ option.title }}</span>
                  <span class="mt-1 block text-xs leading-5 text-gray-500">{{ option.description }}</span>
                </span>
              </span>
            </button>
          }
        </div>

        @if (mode() === 'backup') {
          <div class="mt-4 grid gap-4 rounded-2xl bg-gray-50 p-4 sm:grid-cols-2">
            <label class="block text-sm font-medium text-gray-700">Backup frequency
              <select class="mt-1.5 block w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-bold focus:outline-none focus:ring-2 focus:ring-brand-bold/20"
                [value]="backupFrequency()" (change)="setFrequency($any($event.target).value)">
                <option value="daily">Daily</option><option value="weekly">Weekly (Monday)</option><option value="monthly">Monthly (first day)</option>
              </select>
            </label>
            <label class="block text-sm font-medium text-gray-700">Local backup time
              <input type="time" class="mt-1.5 block w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-bold focus:outline-none focus:ring-2 focus:ring-brand-bold/20"
                [value]="backupTime()" (input)="setBackupTime($any($event.target).value)" />
              <span class="mt-1 block text-xs text-gray-500">Time zone: {{ timeZoneId() }}</span>
            </label>
          </div>
        }
      }

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" class="rounded-full bg-brand-bold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
          [disabled]="loading() || saving() || !dirty()" (click)="save()">
          {{ saving() ? 'Saving…' : 'Save usage settings' }}
        </button>
        @if (saved()) { <span class="text-xs font-medium text-green-700">Settings saved</span> }
        @if ((!saved() || mode() === 'crm') && !loading()) { <span class="text-xs text-amber-700">Choose a cloud usage mode and save it before connecting.</span> }
      </div>
      @if (error()) { <p role="alert" class="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{{ error() }}</p> }
      @if (notice()) { <p role="status" class="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{{ notice() }}</p> }
    </section>
  `,
})
export class StorageUsagePolicyComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  readonly providerId = signal('google-drive');
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly mode = signal<StorageMode>('crm');
  readonly backupFrequency = signal<BackupFrequency>('daily');
  readonly backupTime = signal('22:00');
  readonly timeZoneId = signal(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  private savedKey = '';
  readonly modeOptions: ReadonlyArray<{ id: StorageMode; title: string; description: string }> = [
    { id: 'crm', title: 'Keep CRM storage', description: 'Keep files in the CRM and do not copy them to this provider.' },
    { id: 'primary', title: 'Use cloud storage for new files', description: 'Send new files to this provider. Existing files stay in CRM storage.' },
    { id: 'both', title: 'Use both', description: 'Keep the CRM copy and send a copy of each new file to this provider.' },
    { id: 'backup', title: 'Backups only', description: 'Back up CRM files to this provider on the schedule you choose.' },
  ];

  private readonly onPolicyChanged = (): void => this.load();

  ngOnInit(): void {
    window.addEventListener('taxvision-storage-policy-updated', this.onPolicyChanged);
    this.load();
  }

  ngOnDestroy(): void {
    window.removeEventListener('taxvision-storage-policy-updated', this.onPolicyChanged);
  }

  private get endpoint(): string { return `${this.api.tenantUrl('/storage')}/settings/policy`; }
  private key(): string { return JSON.stringify({ providerId: this.providerId(), mode: this.mode(), frequency: this.mode() === 'backup' ? this.backupFrequency() : null, time: this.mode() === 'backup' ? this.backupTime() : null, zone: this.mode() === 'backup' ? this.timeZoneId() : null }); }
  dirty(): boolean { return !this.loading() && this.key() !== this.savedKey; }
  private changed(): void { this.saved.set(this.key() === this.savedKey); }
  selectProvider(providerId: string): void { this.providerId.set(providerId); this.changed(); }
  selectMode(mode: StorageMode): void { this.mode.set(mode); this.changed(); }
  setFrequency(value: string): void { this.backupFrequency.set(value as BackupFrequency); this.changed(); }
  setBackupTime(value: string): void { this.backupTime.set(value); this.changed(); }

  private load(): void {
    this.loading.set(true);
    this.error.set('');
    this.http.get<StoragePolicy>(this.endpoint).subscribe({
      next: value => {
        this.providerId.set(value.providerId || 'google-drive');
        this.mode.set(value.mode ?? 'crm');
        this.backupFrequency.set(value.backupFrequency ?? 'daily');
        this.backupTime.set(value.backupTime ?? '22:00');
        this.timeZoneId.set(value.backupTimeZoneId ?? this.timeZoneId());
        this.savedKey = this.key(); this.saved.set(true); this.loading.set(false);
      },
      error: error => { this.error.set(this.describeError(error, 'Could not load cloud storage usage settings.')); this.loading.set(false); },
    });
  }

  save(): void {
    if (this.mode() === 'backup' && (!this.backupTime() || !this.timeZoneId())) { this.error.set('Choose a backup time before saving.'); return; }
    this.saving.set(true); this.error.set(''); this.notice.set('');
    this.http.put<void>(this.endpoint, {
      mode: this.mode(), providerId: this.providerId(),
      backupFrequency: this.mode() === 'backup' ? this.backupFrequency() : null,
      backupTime: this.mode() === 'backup' ? this.backupTime() : null,
      backupTimeZoneId: this.mode() === 'backup' ? this.timeZoneId() : null,
    }).subscribe({
      next: () => { this.savedKey = this.key(); this.saved.set(true); this.notice.set('Cloud storage usage settings saved. Connecting does not move existing files.'); this.saving.set(false); window.dispatchEvent(new Event('taxvision-storage-policy-updated')); },
      error: error => { this.saved.set(false); this.error.set(this.describeError(error, 'Could not save cloud storage usage settings.')); this.saving.set(false); },
    });
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as { title?: string; detail?: string; message?: string; description?: string; code?: string; errors?: Record<string, string[]> } | string | null;
      if (typeof body === 'string' && body.trim()) return `${body} (HTTP ${error.status}).`;
      if (body && typeof body === 'object') {
        const validation = Object.values(body.errors ?? {}).flat().join(' ');
        const message = body.detail || body.message || body.description || body.title || validation;
        if (message) return `${body.code ? `${body.code}: ` : ''}${message} (HTTP ${error.status}).`;
      }
      return `${fallback} (HTTP ${error.status}).`;
    }
    return fallback;
  }
}
