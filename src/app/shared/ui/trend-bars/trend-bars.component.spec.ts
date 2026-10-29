import { TestBed } from '@angular/core/testing';
import { TrendBarsComponent, labelStride, niceMax } from './trend-bars.component';

describe('TrendBarsComponent', () => {
  it('rounds the axis up to an even, readable maximum', () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(3)).toBe(4);
    expect(niceMax(9)).toBe(10);
    expect(niceMax(11)).toBe(20);
    expect(niceMax(57)).toBe(60);
    expect(niceMax(100)).toBe(100);
  });

  it('labels every bucket when few, and spreads labels when many', () => {
    expect(labelStride(7)).toBe(1);
    expect(labelStride(30)).toBe(5);
    expect(labelStride(13)).toBe(2);
  });

  function render() {
    TestBed.configureTestingModule({ imports: [TrendBarsComponent] });
    const fixture = TestBed.createComponent(TrendBarsComponent);
    fixture.componentRef.setInput('labels', ['Oct 1', 'Oct 2']);
    fixture.componentRef.setInput('series', [
      { name: 'Sent', values: [3, 5], tone: 'striped' },
      { name: 'Completed', values: [1, 0], tone: 'solid' },
    ]);
    fixture.componentRef.setInput('ariaLabel', 'Sent vs completed: 8 sent, 1 completed.');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('exposes the chart as an image with the summary and a data table alternative', () => {
    const element = render();

    expect(element.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe(
      'Sent vs completed: 8 sent, 1 completed.',
    );
    const rows = Array.from(element.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('th, td'))
        .map((cell) => cell.textContent!.trim())
        .join(' '),
    );
    expect(rows).toEqual(['Oct 1 3 1', 'Oct 2 5 0']);
  });

  it('draws bar heights relative to the rounded maximum', () => {
    const element = render();

    const bars = Array.from(element.querySelectorAll<HTMLElement>('.bar'));
    expect(bars).toHaveLength(4);
    // Máximo 5 → eje 6: 3/6 = 50 %.
    expect(bars[0].style.height).toBe('50%');
    expect(bars[3].style.height).toBe('0%');
  });
});
