import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MailListComponent, MailListRow } from './mail-list.component';

const row = (over: Partial<MailListRow> = {}): MailListRow => ({
  id: 'r1',
  avatarName: 'Ana',
  avatarColor: '#000',
  title: 'Ana',
  subtitle: 'Asunto',
  preview: null,
  time: '10:00',
  badge: null,
  unreadCount: 0,
  ...over,
});

/** Un resultado de búsqueda no leído no trae conteo: se marca igual (negrita + punto), sin globo. */
describe('MailListComponent unread rows', () => {
  const list = () => TestBed.createComponent(MailListComponent).componentInstance;

  it('marca no leído por conteo o por bandera', () => {
    expect(list().isUnread(row({ unreadCount: 2 }))).toBe(true);
    expect(list().isUnread(row({ unread: true }))).toBe(true);
    expect(list().isUnread(row())).toBe(false);
  });

  it('el lector de pantalla dice "unread" sin número cuando no hay conteo', () => {
    expect(list().rowLabel(row({ unread: true }))).toContain('unread');
    expect(list().rowLabel(row({ unreadCount: 3 }))).toContain('3 unread');
  });
});
