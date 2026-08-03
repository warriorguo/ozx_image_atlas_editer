import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

const axios = require('axios');

global.URL.createObjectURL = jest.fn(() => 'mocked-url');
global.URL.revokeObjectURL = jest.fn();

const CELL_SIZE = 25;

const UPLOAD = {
  imageId: 'test-id',
  width: 100,
  height: 100,
  previewUrl: '/api/image/test-id/preview',
};

const SLICE = {
  rows: 4,
  cols: 4,
  cellWidth: CELL_SIZE,
  cellHeight: CELL_SIZE,
  cells: Array.from({ length: 16 }, (_, i) => ({
    cellId: i,
    row: Math.floor(i / 4),
    col: i % 4,
    x: (i % 4) * CELL_SIZE,
    y: Math.floor(i / 4) * CELL_SIZE,
    w: CELL_SIZE,
    h: CELL_SIZE,
  })),
};

/** All `/batch/op` payloads posted so far. */
const opCalls = () =>
  axios.post.mock.calls
    .filter(([url]) => url.includes('/batch/op'))
    .map(([, body]) => body);

// The editor preview carries the same alt text as the grid thumbnail, so
// scope the lookup to the grid.
const thumbnail = (cellId) =>
  screen
    .getAllByAltText(`Cell ${cellId}`)
    .map((img) => img.closest('.cell-thumbnail'))
    .find(Boolean);

/** Press, travel, release — the sequence a real mouse drag produces. */
const drag = async (target, { dx, dy, release = true }) => {
  fireEvent.mouseDown(target, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 100 + dx, clientY: 100 + dy });
  if (release) {
    await act(async () => {
      fireEvent.mouseUp(window, { clientX: 100 + dx, clientY: 100 + dy });
    });
  }
};

/**
 * A click as the browser delivers it: mousedown, then mouseup, then click.
 * Firing click alone hides bugs in anything listening on mousedown.
 */
const clickCell = (target, opts = {}) => {
  fireEvent.mouseDown(target, { button: 0, clientX: 100, clientY: 100, ...opts });
  fireEvent.mouseUp(target, { button: 0, clientX: 100, clientY: 100, ...opts });
  fireEvent.click(target, opts);
};

async function setupSlicedImage() {
  axios.post.mockImplementation((url) => {
    if (url.includes('/slice')) return Promise.resolve({ data: SLICE });
    if (url.includes('/batch/op')) return Promise.resolve({ data: { ok: true } });
    return Promise.resolve({ data: UPLOAD });
  });
  axios.get.mockResolvedValue({ data: { cellIds: [] } });

  const utils = render(<App />);
  const fileInput = utils.container.querySelector('input[type="file"]');
  fireEvent.change(fileInput, {
    target: { files: [new File(['x'], 'test.png', { type: 'image/png' })] },
  });

  const sliceBtn = await screen.findByText('Slice Image');
  fireEvent.click(sliceBtn);
  await waitFor(() =>
    expect(utils.container.querySelectorAll('.cell-thumbnail img')).toHaveLength(16)
  );
  return utils;
}

describe('Drag cell content to set the move offset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('a drag commits exactly one move operation with the drag delta', async () => {
    await setupSlicedImage();

    await drag(thumbnail(0), { dx: 12, dy: -8 });

    await waitFor(() => expect(opCalls()).toHaveLength(1));
    expect(opCalls()[0]).toEqual({
      cellIds: [0],
      operation: { type: 'move', dx: 12, dy: -8 },
    });
  });

  test('screen delta is converted to atlas pixels at the rendered scale', async () => {
    // Render the 25px cell at 50px on screen: 1 atlas px per 2 screen px.
    const rectSpy = jest
      .spyOn(HTMLImageElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 50, height: 50, top: 0, left: 0, right: 50, bottom: 50 });

    await setupSlicedImage();
    await drag(thumbnail(0), { dx: 40, dy: 20 });

    await waitFor(() => expect(opCalls()).toHaveLength(1));
    expect(opCalls()[0].operation).toEqual({ type: 'move', dx: 20, dy: 10 });

    rectSpy.mockRestore();
  });

  test('the scale ignores the preview bitmap size, which may not be the cell size', async () => {
    // The preview endpoint can serve a bitmap at any resolution (and the
    // browser may return a stale one) — only the sliced cell size is truth.
    const rectSpy = jest
      .spyOn(HTMLImageElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 });
    const natSpy = jest
      .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(CELL_SIZE * 4);

    await setupSlicedImage();
    await drag(thumbnail(0), { dx: 100, dy: 0 });

    await waitFor(() => expect(opCalls()).toHaveLength(1));
    // 25px cell shown at 100px → 100 screen px is a quarter of the cell.
    expect(opCalls()[0].operation).toEqual({ type: 'move', dx: 25, dy: 0 });

    natSpy.mockRestore();
    rectSpy.mockRestore();
  });

  test('a drag on a multi-cell selection offsets every selected cell', async () => {
    await setupSlicedImage();

    // Cell 0 is selected after slicing; add cell 1 to the selection.
    clickCell(thumbnail(1), { ctrlKey: true });
    expect(thumbnail(0)).toHaveClass('selected');
    expect(thumbnail(1)).toHaveClass('selected');

    await drag(thumbnail(1), { dx: 5, dy: 5 });

    await waitFor(() => expect(opCalls()).toHaveLength(1));
    expect(opCalls()[0].cellIds).toEqual([0, 1]);
  });

  test('modifier-click still extends the selection despite the mousedown handler', async () => {
    await setupSlicedImage();

    clickCell(thumbnail(3), { metaKey: true });
    clickCell(thumbnail(6), { metaKey: true });

    [0, 3, 6].forEach((id) => expect(thumbnail(id)).toHaveClass('selected'));
    expect(opCalls()).toHaveLength(0);

    // And the accumulated selection is what a subsequent drag moves.
    await drag(thumbnail(6), { dx: 8, dy: 0 });
    await waitFor(() => expect(opCalls()).toHaveLength(1));
    expect(opCalls()[0].cellIds).toEqual([0, 3, 6]);
  });

  test('modifier-click toggles a cell back out of the selection', async () => {
    await setupSlicedImage();

    clickCell(thumbnail(3), { metaKey: true });
    expect(thumbnail(3)).toHaveClass('selected');

    clickCell(thumbnail(3), { metaKey: true });
    expect(thumbnail(3)).not.toHaveClass('selected');
    expect(thumbnail(0)).toHaveClass('selected');
  });

  test('a plain click still selects the cell and records no move', async () => {
    await setupSlicedImage();
    const target = thumbnail(7);

    // Below DRAG_THRESHOLD_PX — a click, not a drag.
    await drag(target, { dx: 2, dy: 1 });
    clickCell(target);

    expect(opCalls()).toHaveLength(0);
    expect(target).toHaveClass('selected');
    expect(thumbnail(0)).not.toHaveClass('selected');
  });

  test('a dragged cell does not have its selection reshuffled by the trailing click', async () => {
    await setupSlicedImage();

    clickCell(thumbnail(1), { ctrlKey: true });
    const target = thumbnail(1);
    await drag(target, { dx: 15, dy: 0 });
    fireEvent.click(target);


    // Still both cells — the click that follows a drag is swallowed.
    expect(thumbnail(0)).toHaveClass('selected');
    expect(thumbnail(1)).toHaveClass('selected');
  });

  test('Escape cancels an in-flight drag without committing', async () => {
    await setupSlicedImage();

    await drag(thumbnail(0), { dx: 20, dy: 20, release: false });
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => {
      fireEvent.mouseUp(window, { clientX: 120, clientY: 120 });
    });

    expect(opCalls()).toHaveLength(0);
  });

  test('a drag returned to its origin commits nothing', async () => {
    await setupSlicedImage();

    fireEvent.mouseDown(thumbnail(0), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 130, clientY: 130 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
    await act(async () => {
      fireEvent.mouseUp(window, { clientX: 100, clientY: 100 });
    });

    expect(opCalls()).toHaveLength(0);
  });

  test('the in-flight offset is mirrored into the X/Y inputs and reset on commit', async () => {
    await setupSlicedImage();

    fireEvent.mouseDown(thumbnail(0), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 109, clientY: 96 });

    const inputs = document.querySelectorAll('.move-control input[type="number"]');
    expect(inputs[0]).toHaveValue(9);
    expect(inputs[1]).toHaveValue(-4);

    await act(async () => {
      fireEvent.mouseUp(window, { clientX: 109, clientY: 96 });
    });

    expect(inputs[0]).toHaveValue(0);
    expect(inputs[1]).toHaveValue(0);
  });

  test('dragging an unselected cell moves that cell alone', async () => {
    await setupSlicedImage();

    await drag(thumbnail(9), { dx: 6, dy: 0 });

    await waitFor(() => expect(opCalls()).toHaveLength(1));
    expect(opCalls()[0].cellIds).toEqual([9]);
    expect(thumbnail(9)).toHaveClass('selected');
  });
});
