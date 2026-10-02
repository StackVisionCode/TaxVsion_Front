import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { TypeaheadComponent } from './typeahead.component';

interface Item {
  id: string;
  name: string;
}

const ALL: Item[] = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Beta' },
  { id: '3', name: 'Alphonse' },
];

@Component({
  imports: [TypeaheadComponent],
  template: `
    <app-typeahead [search]="search" [debounceMs]="0" [minChars]="minChars()" [recent]="recent()"
      [displayWith]="nameOf" [trackBy]="idOf" (picked)="picked.push($event)">
      <ng-template #option let-item let-active="active">
        <span class="opt" [class.active]="active">{{ item.name }}</span>
      </ng-template>
    </app-typeahead>
  `,
})
class HostComponent {
  readonly minChars = signal(0);
  readonly recent = signal<Item[]>([]);
  readonly picked: Item[] = [];
  calls: string[] = [];
  fail = false;
  readonly nameOf = (i: Item) => i.name;
  readonly idOf = (i: Item) => i.id;
  readonly search = (q: string): Observable<Item[]> => {
    this.calls.push(q);
    if (this.fail) {
      return throwError(() => new Error('x'));
    }
    return of(ALL.filter(i => i.name.toLowerCase().includes(q.toLowerCase())));
  };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('TypeaheadComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input') as HTMLInputElement;
    const type = async (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await tick();
      fixture.detectChanges();
    };
    const key = (k: string) => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      fixture.detectChanges();
    };
    const options = () => Array.from(el.querySelectorAll('.opt')).map(o => o.textContent?.trim());
    return { fixture, host: fixture.componentInstance, el, input, type, key, options };
  }

  it('al enfocar sin recientes hace browse con término vacío', async () => {
    const { fixture, host, input, options } = setup();
    input.dispatchEvent(new Event('focus'));
    await tick();
    fixture.detectChanges();
    expect(host.calls).toEqual(['']);
    expect(options()).toEqual(['Alpha', 'Beta', 'Alphonse']);
  });

  it('busca al teclear y elige con flechas + Enter', async () => {
    const { host, input, type, key, options } = setup();
    input.dispatchEvent(new Event('focus'));
    await type('alp');
    expect(options()).toEqual(['Alpha', 'Alphonse']);
    key('ArrowDown');
    key('Enter');
    expect(host.picked.map(p => p.name)).toEqual(['Alphonse']);
    expect(input.value).toBe('');
    expect(options()).toEqual([]);
  });

  it('muestra "No results" y tolera errores', async () => {
    const { host, el, type } = setup();
    await type('zzz');
    expect(el.textContent).toContain('No results');
    host.fail = true;
    await type('al');
    expect(el.textContent).toContain('No results');
  });

  it('con la búsqueda vacía muestra los recientes', async () => {
    const { fixture, host, el, input, options } = setup();
    host.recent.set([ALL[1]]);
    fixture.detectChanges();
    input.dispatchEvent(new Event('focus'));
    await tick();
    fixture.detectChanges();
    expect(host.calls).toEqual([]);
    expect(el.textContent).toContain('Recent');
    expect(options()).toEqual(['Beta']);
  });

  it('respeta minChars', async () => {
    const { fixture, host, el, type, options } = setup();
    host.minChars.set(3);
    fixture.detectChanges();
    await type('al');
    expect(el.textContent).toContain('Type at least 3 characters');
    expect(options()).toEqual([]);
    expect(host.calls).toEqual([]);
  });

  it('Escape cierra', async () => {
    const { type, key, options } = setup();
    await type('a');
    expect(options().length).toBeGreaterThan(0);
    key('Escape');
    expect(options()).toEqual([]);
  });
});
