import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { EmailActivityService } from '@core/postmaster/email-activity.service';
import { ClientProfileEmailDeliveryComponent } from './client-profile-email-delivery.component';

describe('ClientProfileEmailDeliveryComponent', () => {
  let list: ReturnType<typeof vi.fn>;

  function create(email: string) {
    list = vi.fn(() =>
      of({
        items: [
          {
            id: 'm1',
            subject: 'Your return is ready',
            recipients: [email],
            lane: 'SystemProvider',
            status: 'Delivered',
            queuedAtUtc: '2026-10-21T12:00:00',
            sentAtUtc: '2026-10-21T12:00:01',
            lastEventAtUtc: null,
            opened: true,
            clicked: false,
          },
        ],
        page: 1,
        size: 10,
        totalCount: 1,
      }),
    );
    TestBed.configureTestingModule({
      imports: [ClientProfileEmailDeliveryComponent],
      providers: [provideRouter([]), { provide: EmailActivityService, useValue: { list } }],
    });
    const fixture = TestBed.createComponent(ClientProfileEmailDeliveryComponent);
    fixture.componentRef.setInput('email', email);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('busca los correos por la dirección del cliente', () => {
    const fixture = create('maria@client.com');

    expect(list).toHaveBeenCalledWith({ status: 'All', recipient: 'maria@client.com', page: 1, size: 10 });
    expect(fixture.componentInstance.items().map(i => i.id)).toEqual(['m1']);
    expect(fixture.nativeElement.textContent).toContain('Your return is ready');
  });

  it('sin email no consulta nada', () => {
    const fixture = create('  ');

    expect(list).not.toHaveBeenCalled();
    expect(fixture.componentInstance.items()).toEqual([]);
  });
});
