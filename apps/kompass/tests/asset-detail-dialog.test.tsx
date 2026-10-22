// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { AssetDetailDialog } from '@/app/(shell)/admin/media/asset-detail-dialog';
import type { Item } from '@/app/(shell)/admin/media/types';

afterEach(cleanup);

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );

const sampleImage: Item = {
  id: 'asset-1',
  filename: 'test.jpg',
  mimeType: 'image/jpeg',
  bytes: 1024,
  width: 800,
  height: 600,
  createdAt: '2026-10-20T12:00:00Z',
  uploadedBy: 'Admin',
  folder: null,
  references: [],
  aiKind: 'none',
};

const samplePdf: Item = {
  ...sampleImage,
  id: 'asset-2',
  filename: 'test.pdf',
  mimeType: 'application/pdf',
};

describe('AssetDetailDialog AI Labeling', () => {
  it('shows the 3 AI options when aiLabelingEnabled is true for images', () => {
    wrap(
      <AssetDetailDialog
        item={sampleImage}
        folders={[]}
        assetFolder={null}
        onOpenChange={() => {}}
        onMove={async () => ({ status: 'success' })}
        onDelete={async () => ({ status: 'success' })}
        aiLabelingEnabled={true}
      />,
    );
    expect(screen.getByTestId('ai-kind-segmented')).toBeTruthy();
    const names = screen.getAllByRole('radio').map((r) => r.textContent);
    expect(names).toEqual([messages.media.aiKind.none, messages.media.aiKind.edited, messages.media.aiKind.generated]);
  });

  it('hides the AI options when aiLabelingEnabled is false', () => {
    wrap(
      <AssetDetailDialog
        item={sampleImage}
        folders={[]}
        assetFolder={null}
        onOpenChange={() => {}}
        onMove={async () => ({ status: 'success' })}
        onDelete={async () => ({ status: 'success' })}
        aiLabelingEnabled={false}
      />,
    );
    expect(screen.queryByTestId('ai-kind-segmented')).toBeNull();
  });

  it('hides the AI options for PDF files even if aiLabelingEnabled is true', () => {
    wrap(
      <AssetDetailDialog
        item={samplePdf}
        folders={[]}
        assetFolder={null}
        onOpenChange={() => {}}
        onMove={async () => ({ status: 'success' })}
        onDelete={async () => ({ status: 'success' })}
        aiLabelingEnabled={true}
      />,
    );
    expect(screen.queryByTestId('ai-kind-segmented')).toBeNull();
  });

  it('calls onSetAiKind when an option is selected', async () => {
    const onSetAiKind = vi.fn().mockResolvedValue({ status: 'success' });
    wrap(
      <AssetDetailDialog
        item={sampleImage}
        folders={[]}
        assetFolder={null}
        onOpenChange={() => {}}
        onMove={async () => ({ status: 'success' })}
        onDelete={async () => ({ status: 'success' })}
        aiLabelingEnabled={true}
        onSetAiKind={onSetAiKind}
      />,
    );
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    expect(onSetAiKind).toHaveBeenCalledWith('asset-1', 'edited');
  });

  it('springt auf die gespeicherte Art zurück und zeigt den Grund, wenn das Speichern scheitert', async () => {
    const onSetAiKind = vi.fn(async () => ({ status: 'error' as const, message: 'abgelehnt', fieldErrors: {} }));
    wrap(
      <AssetDetailDialog
        item={sampleImage}
        folders={[]}
        assetFolder={null}
        onOpenChange={() => {}}
        onMove={async () => ({ status: 'success' })}
        onDelete={async () => ({ status: 'success' })}
        aiLabelingEnabled={true}
        onSetAiKind={onSetAiKind}
      />,
    );
    fireEvent.click(screen.getAllByRole('radio')[2]!);
    expect((await screen.findByRole('alert')).textContent).toContain('abgelehnt');
    expect(screen.getAllByRole('radio')[0]!.getAttribute('data-checked')).toBe('');
  });

  it('benennt die Auswahl nach ihrer Feldbezeichnung und beschreibt sie mit der Schwelle', () => {
    wrap(
      <AssetDetailDialog
        item={sampleImage}
        folders={[]}
        assetFolder={null}
        onOpenChange={() => {}}
        onMove={async () => ({ status: 'success' })}
        onDelete={async () => ({ status: 'success' })}
        aiLabelingEnabled={true}
        onSetAiKind={async () => ({ status: 'success' })}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: messages.media.aiKind.label });
    const hint = document.getElementById(group.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(messages.media.aiKind.hint);
  });
});
