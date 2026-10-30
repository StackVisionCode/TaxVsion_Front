import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingParticipantTileComponent, ParticipantTileHostAction, ParticipantTileSize } from './participant-tile.component';
import type { MeetingParticipantDto } from '../../meeting.model';
import type { MeetingReaction } from '../../meeting-reactions.util';

function participant(overrides: Partial<MeetingParticipantDto> = {}): MeetingParticipantDto {
  return {
    userId: 'u1',
    displayName: 'Ana López',
    actorType: 'TenantEmployee',
    role: 'Attendee',
    status: 'Joined',
    joinOrder: 2,
    audioEnabled: true,
    videoEnabled: false,
    screenSharing: false,
    handRaised: false,
    handRaisedAtUtc: null,
    connectionQuality: 'Good',
    ...overrides,
  };
}

@Component({
  imports: [MeetingParticipantTileComponent],
  template: `
    <div style="width: 320px; height: 180px">
      <app-meeting-participant-tile [participant]="p()" [stream]="null" [size]="size()" [isSelf]="isSelf()" [isSpeaking]="speaking()"
        [levelBars]="bars()" [pinned]="pinned()" [canHostAct]="canHostAct()" [canMakeHost]="canMakeHost()" [reaction]="reaction()" [nowMs]="now()"
        [clickable]="true" (spotlight)="spotlights = spotlights + 1" (hostAction)="actions.push($event)" />
    </div>
  `,
})
class HostComponent {
  readonly p = signal(participant());
  readonly size = signal<ParticipantTileSize>('xl');
  readonly isSelf = signal(false);
  readonly speaking = signal(false);
  readonly bars = signal(0);
  readonly pinned = signal(false);
  readonly canHostAct = signal(false);
  readonly canMakeHost = signal(false);
  readonly reaction = signal<MeetingReaction | null>(null);
  readonly now = signal(Date.parse('2026-10-30T12:05:00Z'));
  spotlights = 0;
  actions: ParticipantTileHostAction[] = [];
}

function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (role: string) => el.querySelector(`[data-role="${role}"]`) as HTMLElement | null;
  return { fixture, host: fixture.componentInstance, el, q };
}

describe('MeetingParticipantTileComponent — overlays por estado', () => {
  afterEach(() => {
    document.querySelectorAll('[role="menu"]').forEach(n => n.remove());
    TestBed.resetTestingModule();
  });

  it('sin video muestra el avatar y el nombre; con mic apagado el icono de mute en vez del medidor', () => {
    const { fixture, host, q, el } = setup();
    expect(q('camera-off')).not.toBeNull();
    expect(el.querySelector('app-avatar')).not.toBeNull();
    expect(q('name')?.textContent).toContain('Ana López');
    expect(q('meter')).not.toBeNull();
    expect(q('muted')).toBeNull();

    host.p.set(participant({ audioEnabled: false }));
    fixture.detectChanges();
    expect(q('muted')).not.toBeNull();
    expect(q('meter')).toBeNull();
  });

  it('"You" para el propio tile, rol, pantalla compartida, fijado y mano con "hace X"', () => {
    const { fixture, host, q } = setup();
    host.isSelf.set(true);
    host.pinned.set(true);
    host.p.set(participant({ role: 'Cohost', screenSharing: true, handRaised: true, handRaisedAtUtc: '2026-10-30T12:03:00Z' }));
    fixture.detectChanges();
    expect(q('name')?.textContent?.trim()).toContain('You');
    expect(q('role')?.textContent?.trim()).toBe('Co-host');
    expect(q('sharing')).not.toBeNull();
    expect(q('pinned')).not.toBeNull();
    expect(q('hand')?.getAttribute('aria-label')).toBe('Hand raised · 2m ago');
  });

  it('al hablar enciende el anillo y las barras del medidor', () => {
    const { fixture, host, el, q } = setup();
    host.speaking.set(true);
    host.bars.set(2);
    fixture.detectChanges();
    const frame = el.querySelector('[data-user="u1"]') as HTMLElement;
    expect(frame.className).toContain('ring-emerald-400');
    expect(frame.className).toContain('tv-speaking-ring');
    expect(q('meter')?.querySelectorAll('.bg-emerald-400').length).toBe(2);
  });

  it('pinta la burbuja de reacción con la duración de la política y re-dispara por id', () => {
    const { fixture, host, el } = setup();
    host.reaction.set({ id: 'u1:1', userId: 'u1', displayName: 'Ana', emoji: '👏', shownAtMs: 0, expiresAtMs: 4000 });
    fixture.detectChanges();
    const bubble = el.querySelector('[data-role="reaction"]') as HTMLElement;
    expect(bubble.textContent?.trim()).toBe('👏');
    expect(bubble.style.getPropertyValue('--tv-reaction-ms')).toBe('4000ms');

    host.reaction.set({ id: 'u1:2', userId: 'u1', displayName: 'Ana', emoji: '🔥', shownAtMs: 0, expiresAtMs: 4000 });
    fixture.detectChanges();
    const next = el.querySelector('[data-role="reaction"]') as HTMLElement;
    expect(next).not.toBe(bubble);
    expect(next.textContent?.trim()).toBe('🔥');
  });

  it('click en el tile emite spotlight; el menú de host no aparece sin permiso ni para mí', () => {
    const { fixture, host, el, q } = setup();
    (el.querySelector('[data-user="u1"]') as HTMLElement).click();
    expect(host.spotlights).toBe(1);
    expect(q('host-menu')).toBeNull();

    host.canHostAct.set(true);
    host.isSelf.set(true);
    fixture.detectChanges();
    expect(q('host-menu')).toBeNull();
  });

  it('INV-07: el menú de host ofrece co-host/Lower hand/Remove; "Make host" solo con canMakeHost; nada de roles a clientes', () => {
    const { fixture, host, q } = setup();
    host.canHostAct.set(true);
    host.p.set(participant({ handRaised: true, handRaisedAtUtc: '2026-10-30T12:04:00Z' }));
    fixture.detectChanges();
    q('host-menu')!.click();
    fixture.detectChanges();
    const actions = () => [...document.querySelectorAll('[data-action]')].map(b => b.getAttribute('data-action'));
    expect(actions()).toEqual(['promote', 'lowerHand', 'remove']);

    (document.querySelector('[data-action="lowerHand"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.actions).toEqual([{ action: 'lowerHand', userId: 'u1' }]);
    expect(host.spotlights).toBe(0); // el menú no dispara el spotlight

    host.canMakeHost.set(true);
    fixture.detectChanges();
    q('host-menu')!.click(); // reabre (el ítem lo cerró)
    fixture.detectChanges();
    expect(actions()).toContain('makeHost');

    host.p.set(participant({ actorType: 'CustomerPortal', role: 'Attendee' })); // el menú sigue abierto y se re-pinta
    fixture.detectChanges();
    expect(actions()).toEqual(['remove']);
  });

  it('en sm los badges son iconos con tooltip y el menú un icono pequeño', () => {
    const { fixture, host, q, el } = setup();
    host.size.set('sm');
    host.canHostAct.set(true);
    host.p.set(participant({ audioEnabled: false, handRaised: true, handRaisedAtUtc: null, screenSharing: true }));
    fixture.detectChanges();
    expect(q('name')).toBeNull();
    expect(q('hand')?.getAttribute('aria-label')).toBe('Hand raised');
    expect(q('muted')).not.toBeNull();
    expect(q('sharing')).not.toBeNull();
    expect(q('host-menu')?.className).toContain('h-5');
    expect((el.querySelector('[data-user="u1"]') as HTMLElement).getAttribute('title')).toBe('Ana López');
  });

  it('el propio tile se espeja; un remoto no', () => {
    const { fixture, host, el } = setup();
    expect(el.querySelector('video')?.className).not.toContain('-scale-x-100');
    host.isSelf.set(true);
    fixture.detectChanges();
    expect(el.querySelector('video')?.className).toContain('-scale-x-100');
  });
});

describe('ParticipantTile — regresión', () => {
  it('no deja menús portados colgando al destruirse', () => {
    const { fixture, host, q } = setup();
    host.canHostAct.set(true);
    fixture.detectChanges();
    q('host-menu')!.click();
    fixture.detectChanges();
    fixture.destroy();
    expect(document.querySelectorAll('[data-action]').length).toBe(0);
    vi.restoreAllMocks();
  });
});
