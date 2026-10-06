import { Component, Input, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiChannel } from '../../data-access/campaigns.model';

/**
 * Vista previa en vivo del contenido de un canal. Email se muestra en marco de correo (desktop) o de
 * celular (mobile); SMS como burbuja de mensaje en un teléfono; Push como tarjeta de notificación.
 * El HTML del email se renderiza con [innerHTML] (Angular lo sanitiza: sin scripts).
 */
@Component({
  selector: 'app-channel-preview',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-2xl bg-gray-100 p-4">
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs font-semibold text-gray-500">Preview · {{ channel }}</span>
        @if (channel === 'Email') {
          <div class="flex rounded-full bg-white p-0.5 text-xs">
            <button type="button" (click)="device.set('desktop')"
              class="rounded-full px-2.5 py-1 font-semibold" [class]="device() === 'desktop' ? 'bg-blue-600 text-white' : 'text-gray-500'">Email</button>
            <button type="button" (click)="device.set('mobile')"
              class="rounded-full px-2.5 py-1 font-semibold" [class]="device() === 'mobile' ? 'bg-blue-600 text-white' : 'text-gray-500'">Mobile</button>
          </div>
        }
      </div>

      <!-- EMAIL -->
      @if (channel === 'Email') {
        <div class="mx-auto transition-all" [class]="device() === 'mobile' ? 'w-full max-w-[260px]' : 'w-full'">
          <div class="rounded-2xl bg-white shadow-sm overflow-hidden" [class]="device() === 'mobile' ? 'border-[6px] border-gray-900 rounded-[28px]' : 'border border-gray-200'">
            <div class="border-b border-gray-100 px-4 py-2.5">
              <div class="text-[11px] text-gray-400">Subject</div>
              <div class="text-sm font-semibold text-gray-900 truncate">{{ withSamples(subject) || '(no subject)' }}</div>
            </div>
            @if (body) {
              <iframe [srcdoc]="safeDoc(body)" sandbox="allow-same-origin" title="Email preview"
                class="w-full border-0 bg-white" [class]="device() === 'mobile' ? 'h-[460px]' : 'h-[380px]'"></iframe>
            } @else {
              <div class="px-4 py-6 text-sm text-gray-300">Your email content will appear here…</div>
            }
          </div>
        </div>
      }

      <!-- SMS -->
      @if (channel === 'Sms') {
        <div class="mx-auto w-full max-w-[260px] rounded-[28px] border-[6px] border-gray-900 bg-white p-3 min-h-[180px]">
          <div class="text-center text-[11px] text-gray-400 mb-2">Messages</div>
          @if (body) {
            <div class="max-w-[85%] rounded-2xl rounded-bl-sm bg-gray-100 px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap">{{ withSamples(body) }}</div>
            <div class="mt-1 text-[10px] text-gray-400">{{ body.length }} chars · ~{{ smsSegments() }} SMS</div>
          } @else {
            <div class="text-sm text-gray-300">Your SMS text will appear here…</div>
          }
        </div>
      }

      <!-- PUSH -->
      @if (channel === 'Push') {
        <div class="mx-auto w-full max-w-[260px] rounded-[28px] border-[6px] border-gray-900 bg-gradient-to-b from-slate-700 to-slate-900 p-3 min-h-[180px]">
          <div class="text-center text-[11px] text-white/60 mb-3">9:41</div>
          <div class="rounded-2xl bg-white/95 px-3 py-2.5 shadow">
            <div class="flex items-center gap-1.5 mb-1">
              <span class="h-4 w-4 rounded bg-blue-600"></span>
              <span class="text-[11px] font-semibold text-gray-500">Your app · now</span>
            </div>
            <div class="text-sm font-semibold text-gray-900">{{ withSamples(title) || '(no title)' }}</div>
            <div class="text-xs text-gray-700 whitespace-pre-wrap">{{ withSamples(body) || 'Notification body…' }}</div>
          </div>
        </div>
      }
    </div>
  `,
})
export class ChannelPreviewComponent {
  @Input() channel: ApiChannel = 'Email';
  @Input() subject = '';
  @Input() title = '';
  @Input() body = '';

  private readonly sanitizer = inject(DomSanitizer);
  readonly device = signal<'desktop' | 'mobile'>('desktop');
  readonly emptyHtml = '<span style="color:#cbd5e1">Your email content will appear here…</span>';

  /** Documento HTML del email para el iframe (con variables de muestra). Sandbox del iframe bloquea scripts. */
  safeDoc(body: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.withSamples(body));
  }

  /** Valores de muestra para previsualizar la personalización (el envío real usa los datos del cliente). */
  private static readonly SAMPLES: Record<string, string> = {
    first_name: 'María',
    last_name: 'Pérez',
    full_name: 'María Pérez',
    email: 'maria.perez@correo.com',
    phone: '+1 809 555 0142',
  };

  /** Reemplaza {{token}} por un valor de muestra para el preview. Tokens desconocidos quedan igual. */
  withSamples(text: string | null | undefined): string {
    if (!text) return '';
    return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) => ChannelPreviewComponent.SAMPLES[key] ?? m);
  }

  smsSegments(): number {
    return Math.max(1, Math.ceil((this.body?.length ?? 0) / 160));
  }
}
