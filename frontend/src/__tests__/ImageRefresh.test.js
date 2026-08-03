import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';

// Mock axios
jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}));

const axios = require('axios');

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => 'mocked-url');
global.URL.revokeObjectURL = jest.fn();

/**
 * `alt="Cell 0"` is rendered by the grid thumbnail, the editor preview and
 * the sprite player alike, so preview lookups are scoped to their container
 * rather than matched by alt text.
 */
const thumbnails = (container) => [...container.querySelectorAll('.cell-thumbnail img')];
const editorPreview = (container) => container.querySelector('.cell-preview img');
const refreshKeyOf = (img) => {
  const match = img.src.match(/[?&]t=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
};

/**
 * Upload an image and slice it. AsyncImage resolves its loader in a
 * microtask, so callers must wait for the images themselves — a sibling
 * heading like "Cell Editor" renders a tick earlier.
 */
async function uploadAndSlice(container) {
  const fileInput = container.querySelector('input[type="file"]');
  fireEvent.change(fileInput, {
    target: { files: [new File(['dummy'], 'test.png', { type: 'image/png' })] },
  });

  await waitFor(() => screen.getByText(/Slice Image/));
  fireEvent.click(screen.getByText(/Slice Image/));
  await waitFor(() => {
    expect(thumbnails(container)).toHaveLength(2);
    expect(editorPreview(container)).toBeInTheDocument();
  });
}

describe('Image Refresh Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock upload response
    axios.post.mockImplementation((url, data) => {
      if (url === '/api/image/upload') {
        return Promise.resolve({
          data: {
            imageId: 'test-id',
            width: 100,
            height: 100,
            previewUrl: '/api/image/test-id/preview'
          }
        });
      } else if (url.includes('/slice')) {
        return Promise.resolve({
          data: {
            rows: 2, cols: 2, cellWidth: 50, cellHeight: 50,
            cells: [
              { cellId: 0, row: 0, col: 0, x: 0, y: 0, w: 50, h: 50 },
              { cellId: 1, row: 0, col: 1, x: 50, y: 0, w: 50, h: 50 },
            ]
          }
        });
      } else if (url.includes('/op') || url.includes('/undo')) {
        return Promise.resolve({ data: { ok: true } });
      }
      return Promise.reject(new Error('Unexpected URL'));
    });
  });

  test('refreshes images after cell operations', async () => {
    const { container } = render(<App />);
    await uploadAndSlice(container);

    const initialSrc = editorPreview(container).src;

    // Perform erase operation
    fireEvent.click(screen.getByText(/Erase/));

    await waitFor(() => {
      // The src should have changed due to refresh key increment
      expect(editorPreview(container).src).not.toBe(initialSrc);
      // Should contain a timestamp parameter
      expect(editorPreview(container).src).toMatch(/[?&]t=\d+/);
    });
  });

  test('refreshes images after undo operations', async () => {
    const { container } = render(<App />);
    await uploadAndSlice(container);

    const srcBeforeRotate = editorPreview(container).src;

    // Perform operation first
    fireEvent.click(screen.getByText(/Rotate 90°/));
    await waitFor(() => {
      expect(editorPreview(container).src).not.toBe(srcBeforeRotate);
    });
    const srcAfterRotate = editorPreview(container).src;

    // Then undo
    fireEvent.click(screen.getByText(/Undo/));
    await waitFor(() => {
      // Image should refresh after undo
      expect(editorPreview(container).src).not.toBe(srcAfterRotate);
    });
  });

  test('cell grid thumbnails also refresh', async () => {
    const { container } = render(<App />);
    await uploadAndSlice(container);
    expect(screen.getByText(/Cells \(2×2\)/)).toBeInTheDocument();

    const initialSrcs = thumbnails(container).map((img) => img.src);

    // Perform operation
    fireEvent.click(screen.getByText(/Erase/));

    await waitFor(() => {
      // All thumbnails should have refreshed URLs
      thumbnails(container).forEach((img, index) => {
        expect(img.src).not.toBe(initialSrcs[index]);
        expect(img.src).toMatch(/[?&]t=\d+/);
      });
    });
  });

  test('re-slicing refreshes every cell preview (AIE-13)', async () => {
    const { container } = render(<App />);
    await uploadAndSlice(container);

    const srcsAfterFirstSlice = thumbnails(container).map((img) => img.src);

    // Slice again — same imageId and cellIds, but the cells behind them
    // are different now, so the preview URLs must change.
    fireEvent.click(screen.getByText(/Slice Image/));

    await waitFor(() => {
      const srcs = thumbnails(container).map((img) => img.src);
      expect(srcs).toHaveLength(2);
      srcs.forEach((src, i) => expect(src).not.toBe(srcsAfterFirstSlice[i]));
    });

    // The editor preview and sprite player must land on the same key as
    // the grid, not lag a slice behind.
    const gridKey = refreshKeyOf(thumbnails(container)[0]);
    expect(refreshKeyOf(editorPreview(container))).toBe(gridKey);
    expect(refreshKeyOf(container.querySelector('.player-display img'))).toBe(gridKey);
  });

  test('refresh key increments with each operation', async () => {
    const { container } = render(<App />);
    await uploadAndSlice(container);

    const getRefreshKey = () => refreshKeyOf(editorPreview(container));
    const initialKey = getRefreshKey();

    // Perform first operation
    fireEvent.click(screen.getByText(/Erase/));
    await waitFor(() => expect(getRefreshKey()).toBe(initialKey + 1));

    // Perform second operation
    fireEvent.click(screen.getByText(/Undo/));
    await waitFor(() => expect(getRefreshKey()).toBe(initialKey + 2));
  });
});