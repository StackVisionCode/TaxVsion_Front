import { SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MailComposeComponent } from './mail-compose.component';
import { ComposeState } from '../../data-access/mail.store';

const state = (initialTo: string | null): ComposeState => ({
  open: true,
  draft: null,
  loadingDraft: false,
  loadError: null,
  sending: false,
  error: null,
  initialTo,
  customerId: 'c1',
  autoFile: true,
});

/** "Don't file under this client" no debe dejar el correo dirigido al cliente que se precargó. */
describe('MailComposeComponent · desvincular del cliente', () => {
  function open(initialTo: string | null): MailComposeComponent {
    const component = TestBed.createComponent(MailComposeComponent).componentInstance;
    component.state = state(initialTo);
    component.ngOnChanges({ state: new SimpleChange(null, component.state, true) });
    return component;
  }

  it('precarga el email del cliente en To', () => {
    expect(open('ana@clientes.com').to()).toBe('ana@clientes.com');
  });

  it('al desvincular vacía To si solo tenía el email precargado, y avisa al padre', () => {
    const component = open('ana@clientes.com');
    let unlinked = 0;
    component.customerUnlinked.subscribe(() => unlinked++);

    component.unlinkCustomer();

    expect(component.to()).toBe('');
    expect(unlinked).toBe(1);
  });

  it('no toca lo que el usuario escribió', () => {
    const component = open('ana@clientes.com');
    component.to.set('ana@clientes.com, proveedor@empresa.com');

    component.unlinkCustomer();

    expect(component.to()).toBe('ana@clientes.com, proveedor@empresa.com');
  });
});
