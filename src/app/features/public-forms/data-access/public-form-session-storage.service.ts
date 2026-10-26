import { Injectable } from '@angular/core';
import { utcTime } from '@shared/utils/utc-date.util';
import type { PublicFormKind, StoredPublicFormSession } from './public-forms.model';

const PREFIX = 'taxproffice.public-form.session.v1';

@Injectable({ providedIn: 'root' })
export class PublicFormSessionStorageService {
  private readonly fallback = new Map<string, StoredPublicFormSession>();

  read(kind: PublicFormKind, accessToken: string): StoredPublicFormSession | null {
    const key = this.key(kind, accessToken);
    try {
      const value = sessionStorage.getItem(key);
      if (!value) return this.validFallback(key);
      const parsed = JSON.parse(value) as Partial<StoredPublicFormSession>;
      if (
        typeof parsed.sessionToken !== 'string' ||
        typeof parsed.expiresAtUtc !== 'string' ||
        !isFuture(parsed.expiresAtUtc)
      ) {
        this.clear(kind, accessToken);
        return null;
      }
      const session = {
        sessionToken: parsed.sessionToken,
        expiresAtUtc: parsed.expiresAtUtc,
        requestId: typeof parsed.requestId === 'string' ? parsed.requestId : null,
      };
      this.fallback.set(key, session);
      return session;
    } catch {
      return this.validFallback(key);
    }
  }

  write(kind: PublicFormKind, accessToken: string, session: StoredPublicFormSession): void {
    const key = this.key(kind, accessToken);
    this.fallback.set(key, session);
    try {
      sessionStorage.setItem(key, JSON.stringify(session));
    } catch {
      // La sesion actual sigue en memoria cuando storage no esta disponible.
    }
  }

  clear(kind: PublicFormKind, accessToken: string): void {
    const key = this.key(kind, accessToken);
    this.fallback.delete(key);
    try {
      sessionStorage.removeItem(key);
    } catch {
      // El recorrido sigue en memoria cuando storage no esta disponible.
    }
  }

  private key(kind: PublicFormKind, accessToken: string): string {
    return `${PREFIX}.${kind}.${accessToken}`;
  }

  private validFallback(key: string): StoredPublicFormSession | null {
    const session = this.fallback.get(key) ?? null;
    if (session && isFuture(session.expiresAtUtc)) return session;
    this.fallback.delete(key);
    return null;
  }
}

// El backend puede mandar la fecha sin `Z`: `parseUtcDate` la lee como UTC, no como hora local.
function isFuture(value: string): boolean {
  const time = utcTime(value);
  return time != null && time > Date.now();
}
