import { TestBed } from '@angular/core/testing';
import { TurnstileScriptService, type TurnstileApi } from './turnstile-script.service';
import { TurnstileWidgetComponent } from './turnstile-widget.component';

describe('TurnstileWidgetComponent', () => {
  type Callbacks = { callback: (token: string) => void; 'error-callback': () => void };
  let callbacks: Callbacks;
  const api = {
    render: vi.fn((_host: HTMLElement, options: Callbacks) => {
      callbacks = options;
      return 'widget-1';
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };

  async function render() {
    TestBed.configureTestingModule({
      providers: [{ provide: TurnstileScriptService, useValue: { load: async () => api as unknown as TurnstileApi } }],
    });
    const fixture = TestBed.createComponent(TurnstileWidgetComponent);
    fixture.componentInstance.siteKey = 'site';
    fixture.componentInstance.action = 'client_forms_intake';
    const tokens: (string | null)[] = [];
    fixture.componentInstance.tokenChange.subscribe((token) => tokens.push(token));
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, tokens, text: () => (fixture.nativeElement as HTMLElement).textContent ?? '' };
  }

  beforeEach(() => vi.clearAllMocks());

  it('explains a failed check and lets the visitor retry it (it used to leave a blank gap)', async () => {
    const { fixture, tokens, text } = await render();

    callbacks['error-callback']();
    fixture.detectChanges();
    expect(text()).toContain("The security check didn't load.");
    expect(tokens).toEqual([null]);

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    fixture.detectChanges();
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    expect(text()).not.toContain("didn't load");
  });

  it('emits the token once the check passes', async () => {
    const { fixture, tokens, text } = await render();

    callbacks.callback('token-1');
    fixture.detectChanges();

    expect(tokens).toEqual(['token-1']);
    expect(text()).not.toContain('security check');
  });
});
