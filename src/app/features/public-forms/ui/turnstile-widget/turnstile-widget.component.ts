import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnDestroy,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { TurnstileScriptService, type TurnstileApi } from './turnstile-script.service';

type CheckState = 'loading' | 'checking' | 'passed' | 'failed';

@Component({
  selector: 'app-turnstile-widget',
  template: `
    <div role="group" aria-label="Bot protection" [attr.aria-busy]="state() === 'loading' || state() === 'checking'">
      <!-- Reserva el alto del widget (65 px) para que no salte; si falla no queda un hueco vacío. -->
      <div #host [style.min-height.px]="state() === 'failed' ? 0 : 65"></div>
      <!-- Antes un fallo de Turnstile dejaba un hueco en blanco sin explicación. -->
      @switch (state()) {
        @case ('loading') {
          <p class="mt-1 text-xs text-gray-500" role="status">Loading a quick security check…</p>
        }
        @case ('failed') {
          <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-red-700" role="alert">
            <span>The security check didn't load.</span>
            <button
              type="button"
              class="min-h-11 rounded-full border border-red-200 bg-white px-3 font-semibold hover:bg-red-50"
              (click)="reset()"
            >
              Try again
            </button>
          </div>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TurnstileWidgetComponent implements AfterViewInit, OnDestroy {
  private readonly loader = inject(TurnstileScriptService);
  private readonly zone = inject(NgZone);
  private api: TurnstileApi | null = null;
  protected widgetId: string | null = null;
  protected readonly state = signal<CheckState>('loading');

  @Input({ required: true }) siteKey = '';
  @Input({ required: true }) action = '';
  @Output() readonly tokenChange = new EventEmitter<string | null>();
  @Output() readonly unavailable = new EventEmitter<void>();
  @ViewChild('host', { static: true }) private host!: ElementRef<HTMLElement>;

  async ngAfterViewInit(): Promise<void> {
    try {
      this.api = await this.loader.load();
      this.state.set('checking');
      this.widgetId = this.api.render(this.host.nativeElement, {
        sitekey: this.siteKey,
        action: this.action,
        theme: 'light',
        appearance: 'always',
        // Sin reintento automático: el "Try again" del aviso es el único, y aviso y widget no se contradicen.
        retry: 'never',
        callback: (token) => this.zone.run(() => this.settle('passed', token)),
        'expired-callback': () => this.zone.run(() => this.settle('checking', null)),
        'error-callback': () => this.zone.run(() => this.settle('failed', null)),
      });
    } catch {
      this.zone.run(() => this.unavailable.emit());
    }
  }

  reset(): void {
    if (this.api && this.widgetId) this.api.reset(this.widgetId);
    this.settle(this.api ? 'checking' : 'loading', null);
  }

  ngOnDestroy(): void {
    if (this.api && this.widgetId) this.api.remove(this.widgetId);
  }

  private settle(state: CheckState, token: string | null): void {
    this.state.set(state);
    this.tokenChange.emit(token);
  }
}
