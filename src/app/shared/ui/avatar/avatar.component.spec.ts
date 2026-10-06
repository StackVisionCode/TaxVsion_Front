import { TestBed } from '@angular/core/testing';
import { AvatarComponent } from './avatar.component';
import { avatarColorFor } from '../../utils/avatar.util';

describe('AvatarComponent', () => {
  function create(inputs: Record<string, unknown>) {
    TestBed.configureTestingModule({ imports: [AvatarComponent] });
    const fixture = TestBed.createComponent(AvatarComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    const box = fixture.nativeElement.querySelector('span') as HTMLElement;
    return { fixture, box };
  }

  it('pinta iniciales con el color de la semilla y el tamaño pedido', () => {
    const { box } = create({ name: 'Jane Roe', seed: 'id-1', size: 'sm' });
    expect(box.textContent?.trim()).toBe('JR');
    expect(box.classList.contains('h-8')).toBe(true);
    expect(box.classList.contains(avatarColorFor('id-1'))).toBe(true);
  });

  it('sizeClass y colorClass sobreescriben', () => {
    const { box } = create({ name: 'Jane', sizeClass: 'h-9 w-9 text-xs', colorClass: 'bg-red-500' });
    expect(box.classList.contains('h-9')).toBe(true);
    expect(box.classList.contains('h-10')).toBe(false);
    expect(box.classList.contains('bg-red-500')).toBe(true);
  });

  it('muestra la imagen y vuelve a las iniciales si falla', () => {
    const { fixture, box } = create({ name: 'Jane Roe', imageUrl: 'https://x/y.png' });
    const img = box.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    img.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(box.querySelector('img')).toBeNull();
    expect(box.textContent?.trim()).toBe('JR');
  });
});
