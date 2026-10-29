import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { computeMenuPosition, DropdownMenuComponent, MenuItemDirective } from './dropdown-menu.component';

@Component({
  imports: [DropdownMenuComponent, MenuItemDirective],
  template: `
    <div id="row" (click)="rowClicks = rowClicks + 1">
      <app-dropdown-menu ariaLabel="Actions">
        <button id="edit" appMenuItem type="button" (click)="edits = edits + 1">Edit</button>
        <button id="delete" appMenuItem [danger]="true" type="button">Delete</button>
        <div id="stepper">stepper</div>
      </app-dropdown-menu>
    </div>
    <button id="outside" type="button">out</button>
  `,
})
class HostComponent {
  rowClicks = 0;
  edits = 0;
}

@Component({
  imports: [DropdownMenuComponent, MenuItemDirective],
  template: `
    <app-dropdown-menu>
      <button id="custom" menuTrigger type="button">Open</button>
      <button appMenuItem type="button">Item</button>
    </app-dropdown-menu>
  `,
})
class CustomTriggerHost {}

// El panel se porta al <body>: se busca en el documento, no dentro del host.
const menu = (): HTMLElement | null => document.querySelector('[role="menu"]');

describe('DropdownMenuComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    const trigger = el.querySelector('.dm-default-trigger') as HTMLButtonElement;
    return { fixture, el, trigger };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('abre sin propagar el clic a la fila y cierra al pulsar un ítem', () => {
    const { fixture, el, trigger } = setup();
    trigger.click();
    fixture.detectChanges();
    expect(menu()).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.componentInstance.rowClicks).toBe(0);

    (document.querySelector('#edit') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.edits).toBe(1);
    expect(fixture.componentInstance.rowClicks).toBe(0);
    expect(menu()).toBeNull();
    el.remove();
  });

  it('porta el panel al body con position fixed (no lo recorta un overflow del contenedor)', () => {
    const { fixture, el, trigger } = setup();
    trigger.click();
    fixture.detectChanges();

    const panel = menu()!;
    expect(panel.parentElement).toBe(document.body);
    expect(el.contains(panel)).toBe(false);
    expect(panel.classList).toContain('fixed');
    el.remove();
  });

  it('aplica las clases de ítem y danger', () => {
    const { fixture, el, trigger } = setup();
    trigger.click();
    fixture.detectChanges();
    const edit = document.querySelector('#edit')!;
    const del = document.querySelector('#delete')!;
    expect(edit.classList.contains('text-gray-700')).toBe(true);
    expect(del.classList.contains('text-red-500')).toBe(true);
    expect(del.classList.contains('text-gray-700')).toBe(false);
    el.remove();
  });

  it('un pointerdown dentro del panel portado no cuenta como "fuera"', () => {
    const { fixture, el, trigger } = setup();
    trigger.click();
    fixture.detectChanges();

    document.querySelector('#edit')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(menu()).toBeTruthy();
    el.remove();
  });

  it('contenido no-ítem no cierra; fuera y Escape sí', () => {
    const { fixture, el, trigger } = setup();
    trigger.click();
    fixture.detectChanges();
    (document.querySelector('#stepper') as HTMLElement).click();
    fixture.detectChanges();
    expect(menu()).toBeTruthy();

    el.querySelector('#outside')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(menu()).toBeNull();

    trigger.click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(menu()).toBeNull();
    el.remove();
  });

  it('acepta un disparador propio con [menuTrigger]', () => {
    TestBed.configureTestingModule({ imports: [CustomTriggerHost] });
    const fixture = TestBed.createComponent(CustomTriggerHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('#custom') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(menu()).toBeTruthy();
  });

  it('al destruirse con el menú abierto no deja el panel huérfano en el body', () => {
    const { fixture, trigger } = setup();
    trigger.click();
    fixture.detectChanges();
    expect(menu()).toBeTruthy();

    fixture.destroy();
    expect(menu()).toBeNull();
  });
});

describe('computeMenuPosition', () => {
  const viewport = { width: 1000, height: 800 };
  const panel = { width: 180, height: 200 };

  it('abre hacia abajo y alineado a la derecha cuando cabe', () => {
    const pos = computeMenuPosition({ top: 100, bottom: 132, left: 600, right: 632 }, panel, viewport, 'right');

    expect(pos).toEqual({ top: 140, left: 452, up: false });
  });

  it('cerca del borde inferior abre hacia arriba', () => {
    const pos = computeMenuPosition({ top: 700, bottom: 732, left: 600, right: 632 }, panel, viewport, 'right');

    expect(pos.up).toBe(true);
    expect(pos.top).toBe(700 - 8 - 200);
  });

  it('nunca se sale de la ventana por la izquierda ni por la derecha', () => {
    const atLeft = computeMenuPosition({ top: 100, bottom: 132, left: 2, right: 34 }, panel, viewport, 'right');
    const atRight = computeMenuPosition({ top: 100, bottom: 132, left: 980, right: 1012 }, panel, viewport, 'left');

    expect(atLeft.left).toBe(8);
    expect(atRight.left).toBe(1000 - 180 - 8);
  });
});
