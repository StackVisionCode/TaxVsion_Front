import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import type { CustomerSummary } from '@core/customers/customer-summary.model';
import { of, throwError } from 'rxjs';
import type { ActiveConsentNotice } from '../../data-access/client-forms.model';
import { SendExternalFormDialogComponent } from './send-external-form-dialog.component';

const notice: ActiveConsentNotice = {
  id: 'notice-1',
  key: 'identity_notice',
  title: 'Identity verification',
  purpose: 'IdentityVerification',
  versionNumber: 2,
  language: 'en',
  textSnapshot: 'We collect your email to verify your identity.',
  contentHash: 'hash-1',
  publishedAtUtc: '2026-10-01T00:00:00',
};

const client: CustomerSummary = {
  id: 'customer-7',
  kind: 'Individual',
  status: 'Active',
  displayName: 'Grace Hopper',
  primaryEmail: 'Grace@Example.com',
  primaryPhone: null,
  createdAtUtc: '2026-01-01T00:00:00',
};

const page = (items: CustomerSummary[]) => ({
  items,
  page: 1,
  size: 10,
  totalCount: items.length,
  totalPages: 1,
  hasMore: false,
  hasPrevious: false,
});

describe('SendExternalFormDialogComponent', () => {
  const customers = { search: vi.fn(() => of(page([]))) };

  beforeEach(() => {
    customers.search.mockReset();
    customers.search.mockReturnValue(of(page([])));
    TestBed.configureTestingModule({
      providers: [{ provide: CustomerDirectoryStore, useValue: customers }],
    });
  });

  function fill(component: SendExternalFormDialogComponent, email: string): void {
    component.changeEmail(email);
    component.templateId.set('template-1');
  }

  function render(notices: ActiveConsentNotice[] = [notice], canAssignToClient = true) {
    const fixture = TestBed.createComponent(SendExternalFormDialogComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('canAssignToClient', canAssignToClient);
    fixture.componentRef.setInput('templates', [
      { templateId: 'template-1', name: 'Organizer', purpose: 'clientIntake', latestVersionNumber: 2, title: 'Organizer' },
    ]);
    fixture.componentRef.setInput('notices', notices);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    return { fixture, component };
  }

  it('emits the AssignExternalFormRequestRequest fields once the email, template and notice are valid', async () => {
    const { component } = render();
    const sent = vi.fn();
    component.sent.subscribe(sent);

    component.email.set('  prospect@example.com ');
    component.fullName.set('Pat Prospect');
    component.templateId.set('template-1');
    component.taxYear.set('2026');
    component.dueDate.set('2026-11-15');
    await component.submit(new Event('submit'));

    expect(sent).toHaveBeenCalledWith({
      email: 'prospect@example.com',
      fullName: 'Pat Prospect',
      templateId: 'template-1',
      // Con un solo aviso válido se preselecciona.
      entryNoticeKey: 'identity_notice',
      title: null,
      messageToClient: null,
      dueAtUtc: '2026-11-15T00:00:00Z',
      taxYear: 2026,
    });
  });

  it('blocks sending with an invalid email and shows the field error after blur', async () => {
    const { fixture, component } = render();
    const sent = vi.fn();
    component.sent.subscribe(sent);

    component.email.set('not-an-email');
    component.templateId.set('template-1');
    await component.submit(new Event('submit'));
    fixture.detectChanges();

    expect(sent).not.toHaveBeenCalled();
    expect(component.ready()).toBe(false);
    expect(document.body.textContent).toContain('Enter a valid email address.');
    fixture.destroy();
  });

  it('explains that an identity verification notice is needed when there is none', () => {
    const { fixture, component } = render([]);
    component.email.set('prospect@example.com');
    component.templateId.set('template-1');
    fixture.detectChanges();

    expect(component.ready()).toBe(false);
    expect(document.body.textContent).toContain("There's no published identity verification notice");
    fixture.destroy();
  });

  it('starts empty every time it opens', () => {
    const { fixture, component } = render();
    component.email.set('someone@example.com');
    fixture.componentRef.setInput('isOpen', false);
    fixture.componentRef.setInput('isOpen', true);

    expect(component.email()).toBe('');
    fixture.destroy();
  });

  it('warns when the email belongs to a client and lets the staff assign to the client instead', async () => {
    customers.search.mockReturnValue(of(page([client])));
    const { fixture, component } = render();
    const sent = vi.fn();
    const assign = vi.fn();
    component.sent.subscribe(sent);
    component.assignToClient.subscribe(assign);
    fill(component, ' grace@example.com ');

    await component.submit(new Event('submit'));
    fixture.detectChanges();

    expect(customers.search).toHaveBeenCalledWith({
      term: 'grace@example.com',
      status: 'NotArchived',
      page: 1,
      size: 10,
    });
    expect(sent).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="existing-client-warning"]')?.textContent).toContain(
      'This email belongs to client Grace Hopper. Assign the form to the client instead.',
    );
    (Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Assign to client',
    ) as HTMLButtonElement).click();
    expect(assign).toHaveBeenCalledWith({ customerId: 'customer-7', templateId: 'template-1' });
    fixture.destroy();
  });

  it('still sends to the external email with Send anyway', async () => {
    customers.search.mockReturnValue(of(page([client])));
    const { component } = render();
    const sent = vi.fn();
    component.sent.subscribe(sent);
    fill(component, 'grace@example.com');

    await component.checkExistingClient();
    component.sendAnyway();

    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ email: 'grace@example.com' }));
  });

  it('checks the directory when leaving the email field', async () => {
    customers.search.mockReturnValue(of(page([client])));
    const { component } = render();
    component.changeEmail('grace@example.com');

    component.onEmailBlur();
    await vi.waitFor(() => expect(component.matchedClient()?.id).toBe('customer-7'));

    // Cambiar el email borra el aviso del anterior.
    component.changeEmail('other@example.com');
    expect(component.matchedClient()).toBeNull();
  });

  it('does not warn on a partial match', async () => {
    customers.search.mockReturnValue(
      of(page([{ ...client, primaryEmail: 'grace@example.com.mx' }])),
    );
    const { component } = render();
    const sent = vi.fn();
    component.sent.subscribe(sent);
    fill(component, 'grace@example.com');

    await component.submit(new Event('submit'));

    expect(component.matchedClient()).toBeNull();
    expect(sent).toHaveBeenCalled();
  });

  it('does not warn when the directory denies the search (ABAC)', async () => {
    customers.search.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    const { component } = render();
    const sent = vi.fn();
    component.sent.subscribe(sent);
    fill(component, 'grace@example.com');

    await component.submit(new Event('submit'));

    expect(component.matchedClient()).toBeNull();
    expect(sent).toHaveBeenCalled();
  });

  it('without manage permission points to the client profile and offers no shortcut', async () => {
    customers.search.mockReturnValue(of(page([client])));
    const { fixture, component } = render([notice], false);
    fill(component, 'grace@example.com');

    await component.submit(new Event('submit'));
    fixture.detectChanges();

    const warning = document.querySelector('[data-testid="existing-client-warning"]');
    expect(warning?.textContent).toContain("Assign the form from the client's profile");
    const labels = Array.from(warning?.querySelectorAll('button') ?? []).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Send anyway']);
    fixture.destroy();
  });

  it('describes the email field with the error only while it is invalid', () => {
    const { fixture, component } = render();
    const input = () => document.querySelector('#external-email') as HTMLInputElement;

    expect(input().getAttribute('aria-describedby')).toBeNull();
    component.changeEmail('bad');
    component.emailTouched.set(true);
    fixture.detectChanges();
    expect(input().getAttribute('aria-describedby')).toBe('external-email-error');
    fixture.destroy();
  });

  it('puts the select ids only on the select elements', () => {
    const { fixture } = render();
    const matches = document.querySelectorAll('#external-template');
    expect(matches.length).toBe(1);
    expect(matches[0].tagName).toBe('SELECT');
    fixture.destroy();
  });
});
