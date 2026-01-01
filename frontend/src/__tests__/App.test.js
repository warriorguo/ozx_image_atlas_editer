import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import App from '../App';

// Mock axios
jest.mock('axios');
const mockedAxios = axios;

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => 'mocked-url');
global.URL.revokeObjectURL = jest.fn();

describe('App Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders upload interface initially', () => {
    render(<App />);
    
    expect(screen.getByText(/Click or drag to upload an image/)).toBeInTheDocument();
    expect(screen.getByText(/Upload Image/)).toBeInTheDocument();
  });

  test('shows grid controls after image upload', async () => {
    const mockResponse = {
      data: {
        imageId: 'test-id',
        width: 100,
        height: 100,
        previewUrl: '/api/image/test-id/preview'
      }
    };
    mockedAxios.post.mockResolvedValueOnce(mockResponse);

    render(<App />);
    
    const fileInput = screen.getByDisplayValue('');
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    await waitFor(() => {
      expect(screen.getByText(/Rows:/)).toBeInTheDocument();
      expect(screen.getByText(/Cols:/)).toBeInTheDocument();
      expect(screen.getByText(/Slice Image/)).toBeInTheDocument();
    });
  });

  test('handles image slicing', async () => {
    // Mock image upload
    const uploadResponse = {
      data: {
        imageId: 'test-id',
        width: 100,
        height: 100,
        previewUrl: '/api/image/test-id/preview'
      }
    };
    
    // Mock slice response
    const sliceResponse = {
      data: {
        rows: 4,
        cols: 4,
        cellWidth: 25,
        cellHeight: 25,
        cells: Array.from({ length: 16 }, (_, i) => ({
          cellId: i,
          row: Math.floor(i / 4),
          col: i % 4,
          x: (i % 4) * 25,
          y: Math.floor(i / 4) * 25,
          w: 25,
          h: 25
        }))
      }
    };

    mockedAxios.post
      .mockResolvedValueOnce(uploadResponse)
      .mockResolvedValueOnce(sliceResponse);

    render(<App />);
    
    // Upload file
    const fileInput = screen.getByDisplayValue('');
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    await waitFor(() => {
      expect(screen.getByText(/Slice Image/)).toBeInTheDocument();
    });
    
    // Click slice
    fireEvent.click(screen.getByText(/Slice Image/));
    
    await waitFor(() => {
      expect(screen.getByText(/Cells \(4×4\)/)).toBeInTheDocument();
      expect(screen.getByText(/Export Atlas/)).toBeInTheDocument();
    });
  });

  test('handles cell selection and editing', async () => {
    // Setup mocks for full workflow
    const uploadResponse = {
      data: { imageId: 'test-id', width: 100, height: 100, previewUrl: '/api/image/test-id/preview' }
    };
    
    const sliceResponse = {
      data: {
        rows: 2, cols: 2, cellWidth: 50, cellHeight: 50,
        cells: [
          { cellId: 0, row: 0, col: 0, x: 0, y: 0, w: 50, h: 50 },
          { cellId: 1, row: 0, col: 1, x: 50, y: 0, w: 50, h: 50 },
          { cellId: 2, row: 1, col: 0, x: 0, y: 50, w: 50, h: 50 },
          { cellId: 3, row: 1, col: 1, x: 50, y: 50, w: 50, h: 50 }
        ]
      }
    };

    const operationResponse = { data: { ok: true } };

    mockedAxios.post
      .mockResolvedValueOnce(uploadResponse)
      .mockResolvedValueOnce(sliceResponse)
      .mockResolvedValueOnce(operationResponse);

    render(<App />);
    
    // Upload and slice
    const fileInput = screen.getByDisplayValue('');
    fireEvent.change(fileInput, { target: { files: [new File(['dummy'], 'test.png')] } });
    
    await waitFor(() => screen.getByText(/Slice Image/));
    fireEvent.click(screen.getByText(/Slice Image/));
    
    await waitFor(() => {
      expect(screen.getByText(/Cell Editor/)).toBeInTheDocument();
      expect(screen.getByText(/Erase/)).toBeInTheDocument();
      expect(screen.getByText(/Rotate 90°/)).toBeInTheDocument();
    });

    // Test erase operation
    fireEvent.click(screen.getByText(/Erase/));
    
    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/api/image/test-id/cell/0/op',
        { type: 'erase' }
      );
    });
  });

  test('handles rotation operations', async () => {
    // Setup similar to above test
    const uploadResponse = {
      data: { imageId: 'test-id', width: 100, height: 100, previewUrl: '/api/image/test-id/preview' }
    };
    
    const sliceResponse = {
      data: {
        rows: 2, cols: 2, cellWidth: 50, cellHeight: 50,
        cells: [{ cellId: 0, row: 0, col: 0, x: 0, y: 0, w: 50, h: 50 }]
      }
    };

    mockedAxios.post
      .mockResolvedValueOnce(uploadResponse)
      .mockResolvedValueOnce(sliceResponse)
      .mockResolvedValueOnce({ data: { ok: true } });

    render(<App />);
    
    const fileInput = screen.getByDisplayValue('');
    fireEvent.change(fileInput, { target: { files: [new File(['dummy'], 'test.png')] } });
    
    await waitFor(() => screen.getByText(/Slice Image/));
    fireEvent.click(screen.getByText(/Slice Image/));
    
    await waitFor(() => screen.getByText(/Rotate 180°/));
    
    fireEvent.click(screen.getByText(/Rotate 180°/));
    
    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/api/image/test-id/cell/0/op',
        { type: 'rotate', degree: 180 }
      );
    });
  });

  test('handles undo operation', async () => {
    const uploadResponse = {
      data: { imageId: 'test-id', width: 100, height: 100, previewUrl: '/api/image/test-id/preview' }
    };
    
    const sliceResponse = {
      data: {
        rows: 2, cols: 2, cellWidth: 50, cellHeight: 50,
        cells: [{ cellId: 0, row: 0, col: 0, x: 0, y: 0, w: 50, h: 50 }]
      }
    };

    mockedAxios.post
      .mockResolvedValueOnce(uploadResponse)
      .mockResolvedValueOnce(sliceResponse)
      .mockResolvedValueOnce({ data: { ok: true } });

    render(<App />);
    
    const fileInput = screen.getByDisplayValue('');
    fireEvent.change(fileInput, { target: { files: [new File(['dummy'], 'test.png')] } });
    
    await waitFor(() => screen.getByText(/Slice Image/));
    fireEvent.click(screen.getByText(/Slice Image/));
    
    await waitFor(() => screen.getByText(/Undo/));
    
    fireEvent.click(screen.getByText(/Undo/));
    
    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith('/api/image/test-id/cell/0/undo');
    });
  });

  test('handles export atlas', async () => {
    const uploadResponse = {
      data: { imageId: 'test-id', width: 100, height: 100, previewUrl: '/api/image/test-id/preview' }
    };
    
    const sliceResponse = {
      data: { rows: 2, cols: 2, cellWidth: 50, cellHeight: 50, cells: [] }
    };

    const exportResponse = { data: new Blob(['fake-image-data']) };

    mockedAxios.post
      .mockResolvedValueOnce(uploadResponse)
      .mockResolvedValueOnce(sliceResponse);
    
    mockedAxios.get.mockResolvedValueOnce(exportResponse);

    render(<App />);
    
    const fileInput = screen.getByDisplayValue('');
    fireEvent.change(fileInput, { target: { files: [new File(['dummy'], 'test.png')] } });
    
    await waitFor(() => screen.getByText(/Slice Image/));
    fireEvent.click(screen.getByText(/Slice Image/));
    
    await waitFor(() => screen.getByText(/Export Atlas/));
    
    fireEvent.click(screen.getByText(/Export Atlas/));
    
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/api/image/test-id/export', {
        responseType: 'blob'
      });
    });
  });

  test('updates grid parameters', async () => {
    render(<App />);
    
    const rowsInput = screen.getByDisplayValue('8');
    const colsInput = screen.getByDisplayValue('8');
    
    fireEvent.change(rowsInput, { target: { value: '6' } });
    fireEvent.change(colsInput, { target: { value: '4' } });
    
    expect(screen.getByDisplayValue('6')).toBeInTheDocument();
    expect(screen.getByDisplayValue('4')).toBeInTheDocument();
  });

  test('handles API errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    
    mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

    render(<App />);
    
    const fileInput = screen.getByDisplayValue('');
    fireEvent.change(fileInput, { target: { files: [new File(['dummy'], 'test.png')] } });
    
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Upload failed:', expect.any(Error));
      expect(alertSpy).toHaveBeenCalledWith('Failed to upload image');
    });
    
    consoleSpy.mockRestore();
    alertSpy.mockRestore();
  });
});