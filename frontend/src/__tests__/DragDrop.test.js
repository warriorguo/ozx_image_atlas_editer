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

  // The prompt text lives in a child div; the dragover class goes on the
  // .upload-area that owns the drag handlers.
  const uploadArea = () =>
    screen.getByText(/Click or drag to upload an image/).closest('.upload-area');

  test('shows dragover state when dragging files', () => {
    render(<App />);

    // Simulate drag enter
    fireEvent.dragEnter(uploadArea(), {
      dataTransfer: {
        files: [new File(['test'], 'test.png', { type: 'image/png' })]
      }
    });

    expect(uploadArea()).toHaveClass('dragover');
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

    // Enter drag state
    fireEvent.dragEnter(uploadArea());
    expect(uploadArea()).toHaveClass('dragover');

    // Leave drag state
    fireEvent.dragLeave(uploadArea());
    expect(uploadArea()).not.toHaveClass('dragover');
  });

  test('prevents default drag behavior globally', () => {
    const { unmount } = render(<App />);

    // Assert the effect, not the registration: a file dropped anywhere on
    // the document must not make the browser navigate to it.
    const dispatch = (type) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(dispatch('dragover')).toBe(true);
    expect(dispatch('drop')).toBe(true);

    // And the document-level listeners are cleaned up on unmount.
    unmount();
    expect(dispatch('dragover')).toBe(false);
    expect(dispatch('drop')).toBe(false);
  });
});