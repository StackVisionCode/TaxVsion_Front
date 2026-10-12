import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SparklineComponent, sparklinePoints } from './sparkline.component';

describe('sparklinePoints', () => {
  it('sin valores devuelve cadena vacía', () => {
    expect(sparklinePoints([])).toBe('');
  });

  it('un solo valor o todos iguales dibujan una línea plana sobre la base', () => {
    expect(sparklinePoints([5], 100, 32, 2)).toBe('0,30 100,30');
    expect(sparklinePoints([0, 0, 0], 100, 32, 2)).toBe('0,30 50,30 100,30');
  });

  it('el mínimo va abajo y el máximo arriba, repartidos a lo ancho', () => {
    expect(sparklinePoints([0, 10], 100, 32, 2)).toBe('0,30 100,2');
    expect(sparklinePoints([10, 0, 5], 100, 32, 2)).toBe('0,2 50,30 100,16');
  });
});

describe('SparklineComponent', () => {
  it('pinta línea y área con el tono pedido', () => {
    const fixture = TestBed.createComponent(SparklineComponent);
    fixture.componentRef.setInput('values', [1, 3, 2]);
    fixture.componentRef.setInput('tone', 'sand');
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(svg.classList.contains('text-sand-500')).toBe(true);
    expect(svg.querySelector('polyline')).toBeTruthy();
    expect(svg.querySelector('polygon')).toBeTruthy();
  });

  it('sin valores no pinta nada', () => {
    const fixture = TestBed.createComponent(SparklineComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('svg')).toBeNull();
  });
});
