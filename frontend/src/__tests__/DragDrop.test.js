import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('Drag and Drop Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock successful upload response
    axios.post.mockResolvedValue({
      data: {
        imageId: 'test-id',
        width: 100,
        height: 100,
        previewUrl: '/api/image/test-id/preview'
      }
    });
  });

  test('shows dragover state when dragging files', () => {
    render(<App />);
    
    const uploadArea = screen.getByText(/Click or drag to upload an image/);
    
    // Simulate drag enter
    fireEvent.dragEnter(uploadArea, {
      dataTransfer: {
        files: [new File(['test'], 'test.png', { type: 'image/png' })]
      }
    });
    
    expect(uploadArea).toHaveClass('dragover');
    expect(screen.getByText(/Drop image here!/)).toBeInTheDocument();
  });

  test('handles file drop correctly', async () => {
    render(<App />);
    
    const uploadArea = screen.getByText(/Click or drag to upload an image/);
    const file = new File(['test image content'], 'test.png', { type: 'image/png' });
    
    // Simulate file drop
    fireEvent.drop(uploadArea, {
      dataTransfer: {
        files: [file]
      }
    });
    
    // Should call axios post with the file
    expect(axios.post).toHaveBeenCalledWith('/api/image/upload', expect.any(FormData), {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  });

  test('rejects non-image files', () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    
    render(<App />);
    
    const uploadArea = screen.getByText(/Click or drag to upload an image/);
    const textFile = new File(['test content'], 'test.txt', { type: 'text/plain' });
    
    // Simulate dropping a text file
    fireEvent.drop(uploadArea, {
      dataTransfer: {
        files: [textFile]
      }
    });
    
    expect(alertSpy).toHaveBeenCalledWith('Please upload an image file (PNG, JPG, WEBP)');
    expect(axios.post).not.toHaveBeenCalled();
    
    alertSpy.mockRestore();
  });

  test('removes dragover state on drag leave', () => {
    render(<App />);
    
    const uploadArea = screen.getByText(/Click or drag to upload an image/);
    
    // Enter drag state
    fireEvent.dragEnter(uploadArea);
    expect(uploadArea).toHaveClass('dragover');
    
    // Leave drag state
    fireEvent.dragLeave(uploadArea);
    expect(uploadArea).not.toHaveClass('dragover');
  });

  test('prevents default drag behavior globally', () => {
    render(<App />);
    
    const preventDefaultSpy = jest.fn();
    const stopPropagationSpy = jest.fn();
    
    // Simulate global drag events
    const dragEvent = {
      preventDefault: preventDefaultSpy,
      stopPropagation: stopPropagationSpy
    };
    
    // These events should be prevented globally
    document.dispatchEvent(new Event('dragover'));
    document.dispatchEvent(new Event('drop'));
    
    // The component should have added global event listeners
    expect(document.addEventListener).toHaveBeenCalledWith('dragover', expect.any(Function), false);
    expect(document.addEventListener).toHaveBeenCalledWith('drop', expect.any(Function), false);
  });
});