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
} from '@angular/core';
import { TurnstileScriptService, type TurnstileApi } from './turnstile-script.service';

@Component({
  selector: 'app-turnstile-widget',
  template: `
    <div class="min-h-[70px]" aria-label="Bot protection" [attr.aria-busy]="widgetId == null">
      <div #host></div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TurnstileWidgetComponent implements AfterViewInit, OnDestroy {
  private readonly loader = inject(TurnstileScriptService);
  private readonly zone = inject(NgZone);
  private api: TurnstileApi | null = null;
  protected widgetId: string | null = null;

  @Input({ required: true }) siteKey = '';
  @Input({ required: true }) action = '';
  @Output() readonly tokenChange = new EventEmitter<string | null>();
  @Output() readonly unavailable = new EventEmitter<void>();
  @ViewChild('host', { static: true }) private host!: ElementRef<HTMLElement>;

  async ngAfterViewInit(): Promise<void> {
    try {
      this.api = await this.loader.load();
      this.widgetId = this.api.render(this.host.nativeElement, {
        sitekey: this.siteKey,
        action: this.action,
        theme: 'light',
        appearance: 'always',
        callback: (token) => this.zone.run(() => this.tokenChange.emit(token)),
        'expired-callback': () => this.zone.run(() => this.tokenChange.emit(null)),
        'error-callback': () => this.zone.run(() => this.tokenChange.emit(null)),
      });
    } catch {
      this.zone.run(() => this.unavailable.emit());
    }
  }

  reset(): void {
    if (this.api && this.widgetId) this.api.reset(this.widgetId);
    this.tokenChange.emit(null);
  }

  ngOnDestroy(): void {
    if (this.api && this.widgetId) this.api.remove(this.widgetId);
  }
}
