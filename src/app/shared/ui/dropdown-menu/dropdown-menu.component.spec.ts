import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DropdownMenuComponent, MenuItemDirective } from './dropdown-menu.component';

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

  it('abre sin propagar el clic a la fila y cierra al pulsar un ítem', () => {
    const { fixture, el, trigger } = setup();
    trigger.click();
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.componentInstance.rowClicks).toBe(0);

    (el.querySelector('#edit') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.edits).toBe(1);
    expect(fixture.componentInstance.rowClicks).toBe(0);
    expect(el.querySelector('[role="menu"]')).toBeNull();
    el.remove();
  });

  it('aplica las clases de ítem y danger', () => {
    const { fixture, el, trigger } = setup();
    trigger.click();
    fixture.detectChanges();
    const edit = el.querySelector('#edit')!;
    const del = el.querySelector('#delete')!;
    expect(edit.classList.contains('text-gray-700')).toBe(true);
    expect(del.classList.contains('text-red-500')).toBe(true);
    expect(del.classList.contains('text-gray-700')).toBe(false);
    el.remove();
  });

  it('contenido no-ítem no cierra; fuera y Escape sí', () => {
    const { fixture, el, trigger } = setup();
    trigger.click();
    fixture.detectChanges();
    (el.querySelector('#stepper') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeTruthy();

    el.querySelector('#outside')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();

    trigger.click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
    el.remove();
  });

  it('acepta un disparador propio con [menuTrigger]', () => {
    TestBed.configureTestingModule({ imports: [CustomTriggerHost] });
    const fixture = TestBed.createComponent(CustomTriggerHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('#custom') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeTruthy();
  });
});
