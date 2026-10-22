// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaLabelingProvider, useCanLabelMedia } from '@/components/media/media-labeling-provider';

afterEach(cleanup);

function Probe() {
  return <span data-testid="probe">{String(useCanLabelMedia())}</span>;
}

describe('useCanLabelMedia', () => {
  it('ohne Provider darf niemand kennzeichnen', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('false');
  });

  it('liest den Wert der Schale', () => {
    render(<MediaLabelingProvider canLabel><Probe /></MediaLabelingProvider>);
    expect(screen.getByTestId('probe').textContent).toBe('true');
  });
});
