import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { ApiConfigService } from '@core/config/api-config.service';
import { AccessStore } from '@core/access/access.store';

interface CloudConnection { connected: boolean; email: string | null; }
interface StoragePolicy { providerId: string; availableProviders: string[]; mode: string; backupFrequency: string | null; backupTime: string | null; backupTimeZoneId: string | null; }
interface CloudProvider { id: string; name: string; description: string; }
interface PendingSwitch { target: CloudProvider; current: CloudProvider[]; policy: StoragePolicy; }

@Component({
  selector: 'app-cloud-provider-connections',
  imports: [CommonModule],
  template: `
    @if (access.isAdmin() && access.can('cloudstorage.settings.manage')) {
      <section class="space-y-4" aria-label="Cloud provider connections">
        @for (provider of providers; track provider.id) {
          <article class="rounded-[1.5rem] border border-gray-100 bg-white p-6 shadow-sm">
            <div class="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-4">
                <div class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-slate-50" role="img" [attr.aria-label]="provider.name">
                  @if (provider.id === 'google-drive') {
                    <img src="/assets/google-drive.svg" class="size-8" alt="" />
                  } @else if (provider.id === 'onedrive') {
                    <svg viewBox="0 0 24 24" class="size-8" aria-hidden="true"><path fill="#0364B8" d="M14.2 4.4a6.3 6.3 0 0 0-5.9 4.1 5.4 5.4 0 0 0-5.6 7.1h14.8a4.9 4.9 0 0 0 .5-9.8 6.3 6.3 0 0 0-3.8-1.4Z"/><path fill="#0078D4" d="M3 15.6a5.4 5.4 0 0 0 4.8 3h11.5a4.9 4.9 0 0 0 1.9-9.4 5.1 5.1 0 0 1-2.9 6.4Z"/></svg>
                  } @else {
                    <svg viewBox="0 0 28 25" class="size-8" aria-hidden="true"><path fill="#0061FF" d="m8.18 1.5-5.68 3.6 5.68 3.6 5.68-3.6-5.68-3.6Zm11.34 0-5.68 3.6 5.68 3.6 5.68-3.6-5.68-3.6ZM2.5 12.3l5.68 3.6 5.68-3.6-5.68-3.6-5.68 3.6Zm17.02-3.6-5.68 3.6 5.68 3.6 5.68-3.6-5.68-3.6Zm-11.34 10.8 5.68 3.6 5.66-3.6-5.66-3.6-5.68 3.6Z"/></svg>
                  }
                </div>
                <div class="min-w-0">
                  <h2 class="font-semibold text-gray-900">{{ provider.name }}</h2>
                  @if (loading()) { <p class="mt-1 text-sm text-gray-500">Checking connection…</p> }
                  @else if (connections()[provider.id]?.connected) { <p class="mt-1 truncate text-sm text-gray-600">Connected as {{ connections()[provider.id]?.email }}</p> }
                  @else { <p class="mt-1 text-sm text-gray-600">Not connected. Your existing Storage workspace remains available.</p> }
                </div>
              </div>
              @if (connections()[provider.id]?.connected) {
                <button type="button" class="shrink-0 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50" [disabled]="!!busyProvider()" (click)="disconnect(provider)">{{ busyProvider() === provider.id ? 'Working…' : 'Disconnect' }}</button>
              } @else {
                <button type="button" class="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50" [disabled]="!!busyProvider() || loading()" (click)="connect(provider)">{{ busyProvider() === provider.id ? 'Opening…' : 'Connect ' + provider.name }}</button>
              }
            </div>
            <p class="mt-4 text-xs text-gray-500">{{ provider.description }}</p>
          </article>
        }
        @if (notice()) { <p role="status" class="rounded-lg bg-green-50 p-3 text-sm text-green-800">{{ notice() }}</p> }
        @if (error()) { <p role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-800">{{ error() }}</p> }
      </section>

      @if (pendingSwitch(); as change) {
        <div class="fixed inset-0 z-[100] flex items-center justify-center bg-[#083645]/45 p-4 backdrop-blur-sm" role="presentation" (click)="cancelSwitch()">
          <section class="w-full max-w-md rounded-[1.75rem] border border-[#E4DCCF] bg-white p-7 text-[#083645] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="cloud-switch-title" (click)="$event.stopPropagation()">
            <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-700" aria-hidden="true">
              <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0 3h.008v.008H12v-.008ZM10.3 3.9 2.2 18a1.5 1.5 0 0 0 1.3 2.25h17a1.5 1.5 0 0 0 1.3-2.25L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
            </div>
            <h2 id="cloud-switch-title" class="text-xl font-semibold">A cloud provider is already connected</h2>
            <p class="mt-3 text-sm leading-relaxed text-[#3E5F6B]">
              {{ change.current[0]?.name }} is connected to this tenant. To connect {{ change.target.name }}, TaxVision must disconnect the current provider first. Its files in the cloud will not be deleted. Do you want to disconnect it and continue?
            </p>
            <div class="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" (click)="cancelSwitch()" [disabled]="!!busyProvider()" class="h-11 rounded-xl px-5 text-sm font-semibold text-[#3E5F6B] hover:bg-[#F8F4ED] disabled:opacity-60">Cancel</button>
              <button type="button" (click)="confirmSwitch()" [disabled]="!!busyProvider()" class="h-11 rounded-xl bg-[#083645] px-5 text-sm font-semibold text-white hover:bg-[#057BC1] disabled:opacity-60">{{ busyProvider() ? 'Switching…' : 'Disconnect and continue' }}</button>
            </div>
          </section>
        </div>
      }
    }
  `,
})
export class CloudProviderConnectionsComponent {
  readonly access = inject(AccessStore);
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);
  private readonly storageUrl = this.api.tenantUrl('/storage');
  readonly providers: CloudProvider[] = [
    { id: 'google-drive', name: 'Google Drive', description: 'Sign in on Google’s page. TaxVision never asks for or stores your Google password. Access is limited to files created by TaxVision.' },
    { id: 'onedrive', name: 'OneDrive', description: 'Sign in on Microsoft’s page. TaxVision never asks for or stores your Microsoft password. TaxVision saves copies in its OneDrive app folder.' },
    { id: 'dropbox', name: 'Dropbox', description: 'Sign in on Dropbox’s page. TaxVision never asks for or stores your Dropbox password. Copies are stored in the Dropbox app folder created for TaxVision.' },
  ];
  readonly connections = signal<Record<string, CloudConnection>>({});
  readonly loading = signal(true);
  readonly busyProvider = signal<string | null>(null);
  readonly error = signal('');
  readonly notice = signal('');
  readonly pendingSwitch = signal<PendingSwitch | null>(null);

  constructor() {
    const callback = ['googleDrive', 'oneDrive', 'dropbox'].find(key => new URLSearchParams(window.location.search).has(key));
    const result = callback ? new URLSearchParams(window.location.search).get(callback) : null;
    if (callback) window.history.replaceState({}, document.title, window.location.pathname);
    if (result === 'connected') this.notice.set('Cloud provider connected successfully.');
    if (result === 'error') this.error.set('The cloud provider could not finish connecting. Check its OAuth configuration and service logs.');
    if (this.access.isAdmin() && this.access.can('cloudstorage.settings.manage')) this.loadConnections();
    else this.loading.set(false);
  }

  private endpoint(providerId: string): string { return `${this.storageUrl}/providers/${providerId}`; }

  private loadConnections(): void {
    this.loading.set(true);
    let remaining = this.providers.length;
    const settled = (): void => { remaining -= 1; if (remaining === 0) this.loading.set(false); };
    for (const provider of this.providers) {
      this.http.get<CloudConnection>(this.endpoint(provider.id)).subscribe({
        next: value => { this.setConnection(provider.id, value); settled(); },
        error: error => { this.error.set(this.describeError(error, `Could not load the ${provider.name} connection.`)); settled(); },
      });
    }
  }

  private setConnection(providerId: string, value: CloudConnection): void {
    this.connections.update(current => ({ ...current, [providerId]: value }));
  }

  connect(provider: CloudProvider): void {
    this.error.set(''); this.notice.set(''); this.busyProvider.set(provider.id);
    this.http.get<StoragePolicy>(`${this.storageUrl}/settings/policy`).subscribe({
      next: policy => {
        const current = (policy.availableProviders ?? []).filter(id => id !== provider.id).map(id => this.providers.find(item => item.id === id)).filter((item): item is CloudProvider => !!item);
        if (current.length) {
          this.pendingSwitch.set({ target: provider, current, policy });
          this.busyProvider.set(null);
          return;
        }
        if (policy.providerId !== provider.id || policy.mode === 'crm') {
          this.busyProvider.set(null);
          this.error.set(`Select ${provider.name} in the shared cloud usage settings and save a cloud usage mode before connecting.`);
          return;
        }
        this.startAuthorization(provider);
      },
      error: error => { this.busyProvider.set(null); this.error.set(this.describeError(error, 'Could not check the current cloud connection.')); },
    });
  }

  confirmSwitch(): void {
    const pending = this.pendingSwitch();
    if (!pending) return;
    if (pending.policy.mode === 'crm') {
      this.pendingSwitch.set(null);
      this.error.set('Choose and save a cloud usage mode before switching providers.');
      return;
    }
    this.error.set(''); this.busyProvider.set(pending.target.id);
    this.http.put<void>(`${this.storageUrl}/settings/policy`, {
      mode: pending.policy.mode,
      providerId: pending.target.id,
      backupFrequency: pending.policy.mode === 'backup' ? pending.policy.backupFrequency : null,
      backupTime: pending.policy.mode === 'backup' ? pending.policy.backupTime : null,
      backupTimeZoneId: pending.policy.mode === 'backup' ? pending.policy.backupTimeZoneId : null,
    }).subscribe({
      next: () => {
        window.dispatchEvent(new Event('taxvision-storage-policy-updated'));
        this.disconnectSequentially(pending.current, 0, pending.target);
      },
      error: error => { this.busyProvider.set(null); this.error.set(this.describeError(error, 'Could not apply the shared cloud usage settings to the new provider.')); this.pendingSwitch.set(null); },
    });
  }

  private disconnectSequentially(current: CloudProvider[], index: number, target: CloudProvider): void {
    if (index >= current.length) { this.pendingSwitch.set(null); this.startAuthorization(target); return; }
    const provider = current[index];
    this.http.delete<void>(this.endpoint(provider.id)).subscribe({
      next: () => {
        this.setConnection(provider.id, { connected: false, email: null });
        this.disconnectSequentially(current, index + 1, target);
      },
      error: error => { this.busyProvider.set(null); this.error.set(this.describeError(error, `Could not disconnect ${provider.name}.`)); this.pendingSwitch.set(null); },
    });
  }

  cancelSwitch(): void { if (!this.busyProvider()) this.pendingSwitch.set(null); }

  disconnect(provider: CloudProvider): void {
    this.error.set(''); this.notice.set(''); this.busyProvider.set(provider.id);
    this.http.delete<void>(this.endpoint(provider.id)).subscribe({
      next: () => { this.setConnection(provider.id, { connected: false, email: null }); this.notice.set(`${provider.name} disconnected from TaxVision. Files in the provider are not deleted.`); this.busyProvider.set(null); },
      error: error => { this.error.set(this.describeError(error, `Could not disconnect ${provider.name}.`)); this.busyProvider.set(null); },
    });
  }

  private startAuthorization(provider: CloudProvider): void {
    this.http.post<{ authorizationUrl: string }>(`${this.endpoint(provider.id)}/connect`, {}).subscribe({
      next: response => window.location.assign(response.authorizationUrl),
      error: error => { this.busyProvider.set(null); this.error.set(this.describeError(error, `Could not start ${provider.name} authorization.`)); },
    });
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as { title?: string; detail?: string; message?: string; description?: string } | string | null;
      const message = typeof body === 'string' ? body : body?.detail || body?.message || body?.description || body?.title;
      return message ? `${message} (HTTP ${error.status}).` : `${fallback} (HTTP ${error.status}).`;
    }
    return fallback;
  }
}
