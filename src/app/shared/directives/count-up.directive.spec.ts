import { describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CountUpDirective, formatCount } from './count-up.directive';

@Component({
  imports: [CountUpDirective],
  template: `<span [appCountUp]="value" [countUpDuration]="0" [countUpFormat]="format"></span>`,
})
class HostComponent {
  value = 1234;
  format: ((v: number) => string) | null = null;
}

function render(value: number, format: ((v: number) => string) | null): string {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.value = value;
  fixture.componentInstance.format = format;
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector('span')!.textContent ?? '';
}

describe('CountUpDirective', () => {
  it('sin formato usa formatCount', () => {
    expect(render(1234, null)).toBe('1,234');
  });

  it('con countUpFormat formatea el valor redondeado (p. ej. dinero en centavos)', () => {
    const cents = (c: number) => `$${(c / 100).toFixed(2)}`;
    expect(render(123456, cents)).toBe('$1234.56');
  });
});

describe('formatCount', () => {
  it('renders small integers as-is', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(7)).toBe('7');
  });

  it('groups thousands so a big import reads clearly', () => {
    expect(formatCount(1240)).toBe('1,240');
    expect(formatCount(1000000)).toBe('1,000,000');
  });

  it('rounds fractional in-flight values (the tween passes through decimals)', () => {
    expect(formatCount(1239.6)).toBe('1,240');
    expect(formatCount(3.2)).toBe('3');
  });
});
