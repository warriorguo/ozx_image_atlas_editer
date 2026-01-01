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
    render(<App />);
    
    // Upload and slice image
    const fileInput = screen.getByDisplayValue('');
    fireEvent.change(fileInput, { 
      target: { files: [new File(['dummy'], 'test.png', { type: 'image/png' })] } 
    });
    
    await waitFor(() => screen.getByText(/Slice Image/));
    fireEvent.click(screen.getByText(/Slice Image/));
    
    await waitFor(() => screen.getByText(/Cell Editor/));
    
    // Get initial cell preview image
    const cellPreview = screen.getByAltText(/Cell 0/);
    const initialSrc = cellPreview.src;
    
    // Perform erase operation
    fireEvent.click(screen.getByText(/Erase/));
    
    await waitFor(() => {
      const updatedCellPreview = screen.getByAltText(/Cell 0/);
      // The src should have changed due to refresh key increment
      expect(updatedCellPreview.src).not.toBe(initialSrc);
      // Should contain a timestamp parameter
      expect(updatedCellPreview.src).toMatch(/[?&]t=\d+/);
    });
  });

  test('refreshes images after undo operations', async () => {
    render(<App />);
    
    // Setup image and slice
    const fileInput = screen.getByDisplayValue('');
    fireEvent.change(fileInput, { 
      target: { files: [new File(['dummy'], 'test.png', { type: 'image/png' })] } 
    });
    
    await waitFor(() => screen.getByText(/Slice Image/));
    fireEvent.click(screen.getByText(/Slice Image/));
    
    await waitFor(() => screen.getByText(/Cell Editor/));
    
    // Perform operation first
    fireEvent.click(screen.getByText(/Rotate 90°/));
    
    await waitFor(() => {
      const cellPreview = screen.getByAltText(/Cell 0/);
      const srcAfterRotate = cellPreview.src;
      
      // Then undo
      fireEvent.click(screen.getByText(/Undo/));
      
      return waitFor(() => {
        const cellPreviewAfterUndo = screen.getByAltText(/Cell 0/);
        // Image should refresh after undo
        expect(cellPreviewAfterUndo.src).not.toBe(srcAfterRotate);
      });
    });
  });

  test('cell grid thumbnails also refresh', async () => {
    render(<App />);
    
    // Setup
    const fileInput = screen.getByDisplayValue('');
    fireEvent.change(fileInput, { 
      target: { files: [new File(['dummy'], 'test.png', { type: 'image/png' })] } 
    });
    
    await waitFor(() => screen.getByText(/Slice Image/));
    fireEvent.click(screen.getByText(/Slice Image/));
    
    await waitFor(() => screen.getByText(/Cells \(2×2\)/));
    
    // Get all cell thumbnail images
    const cellThumbnails = screen.getAllByAltText(/Cell \d+/);
    const initialSrcs = cellThumbnails.map(img => img.src);
    
    // Perform operation
    fireEvent.click(screen.getByText(/Erase/));
    
    await waitFor(() => {
      const updatedThumbnails = screen.getAllByAltText(/Cell \d+/);
      // All thumbnails should have refreshed URLs
      updatedThumbnails.forEach((img, index) => {
        expect(img.src).not.toBe(initialSrcs[index]);
        expect(img.src).toMatch(/[?&]t=\d+/);
      });
    });
  });

  test('refresh key increments with each operation', async () => {
    render(<App />);
    
    // Setup
    const fileInput = screen.getByDisplayValue('');
    fireEvent.change(fileInput, { 
      target: { files: [new File(['dummy'], 'test.png', { type: 'image/png' })] } 
    });
    
    await waitFor(() => screen.getByText(/Slice Image/));
    fireEvent.click(screen.getByText(/Slice Image/));
    
    await waitFor(() => screen.getByText(/Cell Editor/));
    
    // Get initial refresh key from URL
    const getRefreshKey = () => {
      const cellPreview = screen.getByAltText(/Cell 0/);
      const match = cellPreview.src.match(/[?&]t=(\d+)/);
      return match ? parseInt(match[1]) : 0;
    };
    
    const initialKey = getRefreshKey();
    
    // Perform first operation
    fireEvent.click(screen.getByText(/Erase/));
    
    await waitFor(() => {
      const keyAfterErase = getRefreshKey();
      expect(keyAfterErase).toBe(initialKey + 1);
    });
    
    // Perform second operation
    fireEvent.click(screen.getByText(/Undo/));
    
    await waitFor(() => {
      const keyAfterUndo = getRefreshKey();
      expect(keyAfterUndo).toBe(initialKey + 2);
    });
  });
});