import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

export interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: 'light';
      appearance: 'always';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = 'taxproffice-turnstile';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

@Injectable({ providedIn: 'root' })
export class TurnstileScriptService {
  private readonly document = inject(DOCUMENT);
  private loading: Promise<TurnstileApi> | null = null;

  load(): Promise<TurnstileApi> {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (this.loading) return this.loading;
    this.loading = new Promise<TurnstileApi>((resolve, reject) => {
      const existing = this.document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
      const script = existing ?? this.document.createElement('script');
      const complete = (): void =>
        window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile unavailable'));
      script.addEventListener('load', complete, { once: true });
      script.addEventListener('error', () => reject(new Error('Turnstile unavailable')), {
        once: true,
      });
      if (!existing) {
        script.id = SCRIPT_ID;
        script.src = SCRIPT_URL;
        script.async = true;
        script.defer = true;
        this.document.head.appendChild(script);
      }
    }).catch((error) => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }
}
