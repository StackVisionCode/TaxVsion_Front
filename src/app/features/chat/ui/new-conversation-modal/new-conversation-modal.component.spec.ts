import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { NewConversationModalComponent, GroupCreateRequest } from './new-conversation-modal.component';
import type { CustomerDirectoryEntry, EmployeeDirectoryEntry } from '../../data-access/chat.model';

/** F8b (ADD-02 H-1, D-20) — el modo Group junta equipo y clientes y avisa si habrá más de un cliente. */
describe('NewConversationModalComponent — grupos', () => {
  const employee = (userId: string, displayName: string): EmployeeDirectoryEntry => ({ userId, displayName, email: `${userId}@x.test`, isActive: true, actorType: 'TenantEmployee' });
  const customer = (customerId: string, portalUserId: string | null, displayName: string): CustomerDirectoryEntry => ({
    customerId, portalUserId, displayName, email: `${customerId}@x.test`, isActive: true,
  });

  function render() {
    const fixture = TestBed.createComponent(NewConversationModalComponent);
    fixture.componentRef.setInput('canCreateGroups', true);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    // app-modal monta su contenido al abrirse (señal interna): un segundo ciclo lo pinta.
    fixture.detectChanges();
    return fixture;
  }

  it('elige equipo y clientes, conserva la selección al cambiar de audiencia y emite ids + descripción', () => {
    const fixture = render();
    const cmp = fixture.componentInstance;
    const requests: GroupCreateRequest[] = [];
    cmp.groupCreateRequested.subscribe(r => requests.push(r));

    cmp.mode.set('group');
    cmp.setAudience('team');
    cmp.selectEmployee(employee('e1', 'Ana'));
    cmp.setAudience('clients');
    cmp.selectCustomer(customer('c1', 'p1', 'Diego'));
    cmp.selectCustomer(customer('c2', null, 'No portal'));
    expect(cmp.selectedMembers().map(m => m.userId)).toEqual(['e1', 'p1']);

    cmp.groupTitle.set('Tax team');
    cmp.groupDescription.set('  Q4  ');
    cmp.createGroup();
    expect(requests).toEqual([{ title: 'Tax team', memberUserIds: ['e1', 'p1'], description: 'Q4' }]);
  });

  it('con más de un cliente avisa que se verán entre sí', () => {
    const fixture = render();
    const cmp = fixture.componentInstance;
    cmp.mode.set('group');
    cmp.selectCustomer(customer('c1', 'p1', 'Diego'));
    fixture.detectChanges();
    // app-modal porta su panel a document.body.
    const el = document.body;
    expect(el.querySelector('[data-role="clients-see-each-other"]')).toBeNull();
    cmp.selectCustomer(customer('c2', 'p2', 'Eva'));
    fixture.detectChanges();
    expect(el.querySelector('[data-role="clients-see-each-other"]')?.textContent).toContain('Clients in this group will see each other.');
  });
});
