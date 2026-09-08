import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, tap } from 'rxjs';
import { toApiError } from '@core/models/api-error.model';
import { ClientPortalService } from './client-portal.service';
import {
  InvitationResponse,
  PortalAccess,
  PortalUserResponse,
  derivePortalAccess,
} from './client-portal.model';

/**
 * Store de la pestaña "Portal access" del perfil. No hay un endpoint de "estado de portal": se
 * deriva de las invitaciones + el usuario de portal del cliente (Auth, filtrados por `customerId`).
 * `providedIn: 'root'` con estado por cliente. Las lecturas toleran un 403 (permiso parcial): si
 * falta `users.invite`/`users.view`, esa lista queda vacía y el estado se deriva de lo que sí se ve.
 */
@Injectable({ providedIn: 'root' })
export class ClientPortalStore {
  private readonly service = inject(ClientPortalService);

  private customerId = '';
  private fallbackEmail = '';

  private readonly _invitations = signal<InvitationResponse[]>([]);
  private readonly _users = signal<PortalUserResponse[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly access = computed<PortalAccess>(() =>
    derivePortalAccess(this._invitations(), this._users(), this.fallbackEmail),
  );

  load(customerId: string, email: string): void {
    if (customerId !== this.customerId) {
      this.customerId = customerId;
      this._invitations.set([]);
      this._users.set([]);
    }
    this.fallbackEmail = email;
    this.refresh();
  }

  refresh(): void {
    if (!this.customerId) {
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    forkJoin({
      // Tolera 403 (permiso parcial): la lista que no se puede leer queda vacía.
      invitations: this.service.listInvitations(this.customerId).pipe(catchError(() => of(null))),
      users: this.service.listUsers(this.customerId).pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ invitations, users }) => {
        this._invitations.set(invitations?.items ?? []);
        this._users.set(users?.items ?? []);
        this._loading.set(false);
      },
      error: err => {
        this._error.set(toApiError(err).message);
        this._loading.set(false);
      },
    });
  }

  invite(): Observable<void> {
    return this.service.invite(this.customerId).pipe(
      tap(() => this.refresh()),
      map(() => undefined),
    );
  }

  resend(invitationId: string): Observable<void> {
    return this.service.resendInvitation(invitationId).pipe(
      tap(() => this.refresh()),
      map(() => undefined),
    );
  }

  cancel(invitationId: string): Observable<void> {
    return this.service.cancelInvitation(invitationId).pipe(
      tap(() => this.refresh()),
      map(() => undefined),
    );
  }

  deactivate(userId: string): Observable<void> {
    return this.service.deactivateUser(userId).pipe(
      tap(() => this.refresh()),
      map(() => undefined),
    );
  }

  reactivate(userId: string): Observable<void> {
    return this.service.reactivateUser(userId).pipe(
      tap(() => this.refresh()),
      map(() => undefined),
    );
  }
}
