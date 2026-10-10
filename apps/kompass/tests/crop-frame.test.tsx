// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CropFrame, mediaPreviewUrl, proposalImageUrl } from '@/app/(shell)/animals/crop-frame';

afterEach(cleanup);

describe('CropFrame', () => {
  it('darkens outside the crop rectangle and names it for screen readers', () => {
    render(<CropFrame src="/x.webp" crop={{ x: 0.1, y: 0.2, w: 0.5, h: 0.6 }} label="Ausschnitt der Quelle" />);
    const frame = screen.getByTestId('crop-rect');
    expect(frame.style.left).toBe('10%');
    expect(frame.style.top).toBe('20%');
    expect(frame.style.width).toBe('50%');
    expect(frame.style.height).toBe('60%');
    expect(screen.getAllByTestId('crop-shade')).toHaveLength(4);
    expect(screen.getByRole('img', { name: 'Ausschnitt der Quelle' })).toBeTruthy();
  });

  it('shows the whole photo without shade when there is no crop', () => {
    render(<CropFrame src="/x.webp" crop={null} label="Foto" />);
    expect(screen.queryByTestId('crop-rect')).toBeNull();
    expect(screen.queryAllByTestId('crop-shade')).toHaveLength(0);
    expect(screen.getByRole('img', { name: 'Foto' })).toBeTruthy();
  });

  it('builds the addresses of proposal images and media previews', () => {
    expect(proposalImageUrl('I1')).toBe('/animals/proposal-images/I1');
    expect(proposalImageUrl('I1', 'original')).toBe('/animals/proposal-images/I1?variant=original');
    expect(mediaPreviewUrl('A1')).toBe('/media/A1/preview');
  });
});
