import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@core/auth/auth.service';
import { StaffDirectoryStore } from '@core/staff/staff-directory.store';
import { AppNotification, NotificationListComponent } from './notification-list.component';

function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    kind: 'customer.assigned',
    type: 'customer_assigned',
    priority: 'Normal',
    category: null,
    title: 'Client assigned',
    message: 'Ana assigned you a client',
    time: '1m ago',
    createdAtUtc: '2026-10-28T10:00:00Z',
    occurredAtUtc: null,
    createdAt: Date.parse('2026-10-28T10:00:00Z'),
    actorUserId: 'u-ana',
    actorDisplayName: 'Ana Lopez',
    actorType: 'TenantEmployee',
    resourceType: null,
    resourceId: null,
    resourceContext: {},
    action: null,
    metadata: {},
    isRead: false,
    ...overrides,
  };
}

/** El actor del staff sale con su foto; sin foto (o si es el sistema) se conserva el círculo de siempre. */
describe('NotificationListComponent — foto del actor', () => {
  const photos: Record<string, string> = { 'u-ana': 'https://api.test/storage/avatars/f-ana' };
  const staff = {
    ensureLoaded: vi.fn(),
    avatarUrlFor: (id: string | null | undefined) => (id ? (photos[id] ?? null) : null),
  };

  function render(items: AppNotification[]) {
    TestBed.configureTestingModule({
      imports: [NotificationListComponent],
      providers: [
        { provide: StaffDirectoryStore, useValue: staff },
        { provide: AuthService, useValue: { currentUser: () => null } },
      ],
    });
    const fixture = TestBed.createComponent(NotificationListComponent);
    fixture.componentInstance.notifications = items;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('pinta la foto del actor cuando el directorio la tiene', () => {
    const el = render([notification()]);
    expect(el.querySelector('app-avatar img')?.getAttribute('src')).toBe('https://api.test/storage/avatars/f-ana');
    expect(staff.ensureLoaded).toHaveBeenCalled();
  });

  it('sin foto, o si el actor es el sistema, queda el círculo con iniciales/icono', () => {
    const el = render([
      notification({ id: 'n2', actorUserId: 'u-bob', actorDisplayName: 'Bob Stone' }),
      notification({ id: 'n3', actorType: 'System' }),
    ]);
    expect(el.querySelector('app-avatar')).toBeNull();
    expect(el.textContent).toContain('BS');
  });
});
