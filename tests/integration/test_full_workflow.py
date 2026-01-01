#!/usr/bin/env python3
"""
Integration tests for the Atlas Image Editor.
Tests the full workflow from image upload to export.
"""

import pytest
import requests
import json
import os
import time
import subprocess
import signal
from PIL import Image
import io


class TestServer:
    def __init__(self, port=5001):  # Use different port to avoid conflicts
        self.port = port
        self.base_url = f"http://localhost:{port}"
        self.process = None
    
    def start(self):
        """Start the Flask server for testing."""
        import sys
        backend_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'backend')
        
        env = os.environ.copy()
        env['FLASK_ENV'] = 'testing'
        
        self.process = subprocess.Popen(
            [sys.executable, 'app.py'],
            cwd=backend_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=os.setsid if hasattr(os, 'setsid') else None
        )
        
        # Wait for server to start
        for _ in range(30):  # 3 second timeout
            try:
                response = requests.get(f"{self.base_url}/api/image/test/preview")
                break  # Server is responding
            except requests.exceptions.ConnectionError:
                time.sleep(0.1)
        else:
            raise RuntimeError("Server failed to start")
    
    def stop(self):
        """Stop the Flask server."""
        if self.process:
            if hasattr(os, 'killpg'):
                os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
            else:
                self.process.terminate()
            self.process.wait()
            self.process = None


@pytest.fixture(scope="session")
def test_server():
    """Start test server for the session."""
    server = TestServer()
    server.start()
    yield server
    server.stop()


@pytest.fixture
def fixtures_dir():
    """Get path to test fixtures directory."""
    return os.path.join(os.path.dirname(__file__), '..', 'fixtures')


class TestFullWorkflow:
    
    def test_complete_atlas_editing_workflow(self, test_server, fixtures_dir):
        """Test the complete workflow: upload -> slice -> edit -> export."""
        
        # 1. Upload image
        image_path = os.path.join(fixtures_dir, 'test_rgb_100x100.png')
        with open(image_path, 'rb') as f:
            files = {'file': ('test.png', f, 'image/png')}
            response = requests.post(f"{test_server.base_url}/api/image/upload", files=files)
        
        assert response.status_code == 200
        upload_data = response.json()
        image_id = upload_data['imageId']
        assert upload_data['width'] == 100
        assert upload_data['height'] == 100
        
        # 2. Slice image into grid
        slice_data = {'rows': 4, 'cols': 4}
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/slice", 
                               json=slice_data)
        
        assert response.status_code == 200
        slice_result = response.json()
        assert slice_result['rows'] == 4
        assert slice_result['cols'] == 4
        assert slice_result['cellWidth'] == 25
        assert slice_result['cellHeight'] == 25
        assert len(slice_result['cells']) == 16
        
        # 3. Apply operations to different cells
        # Erase cell 0
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/cell/0/op",
                               json={'type': 'erase'})
        assert response.status_code == 200
        
        # Rotate cell 1 by 90 degrees
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/cell/1/op",
                               json={'type': 'rotate', 'degree': 90})
        assert response.status_code == 200
        
        # Rotate cell 2 by 180 degrees
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/cell/2/op",
                               json={'type': 'rotate', 'degree': 180})
        assert response.status_code == 200
        
        # 4. Verify cell previews
        # Check erased cell is transparent
        response = requests.get(f"{test_server.base_url}/api/image/{image_id}/cell/0/preview")
        assert response.status_code == 200
        cell_image = Image.open(io.BytesIO(response.content))
        assert cell_image.size == (25, 25)
        # Check that it's transparent
        pixels = list(cell_image.getdata())
        assert all(pixel[3] == 0 for pixel in pixels)  # All pixels should be transparent
        
        # Check rotated cell
        response = requests.get(f"{test_server.base_url}/api/image/{image_id}/cell/1/preview")
        assert response.status_code == 200
        rotated_cell = Image.open(io.BytesIO(response.content))
        assert rotated_cell.size == (25, 25)
        
        # 5. Test undo functionality
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/cell/1/undo")
        assert response.status_code == 200
        assert response.json()['ok'] is True
        
        # Verify cell 1 is back to original
        response = requests.get(f"{test_server.base_url}/api/image/{image_id}/cell/1/preview")
        original_cell = Image.open(io.BytesIO(response.content))
        
        # 6. Export atlas
        response = requests.get(f"{test_server.base_url}/api/image/{image_id}/export")
        assert response.status_code == 200
        assert response.headers['content-type'] == 'image/png'
        
        # Verify exported atlas
        atlas_image = Image.open(io.BytesIO(response.content))
        assert atlas_image.size == (100, 100)  # Should match original size
        assert atlas_image.mode == 'RGBA'
        
        # Verify that top-left cell (0,0) is transparent due to erase
        tl_pixel = atlas_image.getpixel((0, 0))
        assert tl_pixel[3] == 0, "Top-left cell should be transparent after erase"
    
    def test_rgba_image_workflow(self, test_server, fixtures_dir):
        """Test workflow with RGBA image that has transparency."""
        
        # Upload RGBA image
        image_path = os.path.join(fixtures_dir, 'test_rgba_64x64.png')
        with open(image_path, 'rb') as f:
            files = {'file': ('test_rgba.png', f, 'image/png')}
            response = requests.post(f"{test_server.base_url}/api/image/upload", files=files)
        
        assert response.status_code == 200
        image_id = response.json()['imageId']
        
        # Slice into 2x2 grid
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/slice",
                               json={'rows': 2, 'cols': 2})
        assert response.status_code == 200
        
        # Apply rotation to cell with transparency
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/cell/0/op",
                               json={'type': 'rotate', 'degree': 270})
        assert response.status_code == 200
        
        # Export and verify alpha preservation
        response = requests.get(f"{test_server.base_url}/api/image/{image_id}/export")
        atlas_image = Image.open(io.BytesIO(response.content))
        assert atlas_image.mode == 'RGBA'
        
        # Verify some transparency is preserved
        has_partial_alpha = any(0 < pixel[3] < 255 for pixel in atlas_image.getdata())
        assert has_partial_alpha, "Original transparency should be preserved"
    
    def test_non_square_image_workflow(self, test_server, fixtures_dir):
        """Test workflow with rectangular image."""
        
        image_path = os.path.join(fixtures_dir, 'test_rect_120x80.png')
        with open(image_path, 'rb') as f:
            files = {'file': ('rect.png', f, 'image/png')}
            response = requests.post(f"{test_server.base_url}/api/image/upload", files=files)
        
        image_id = response.json()['imageId']
        
        # Slice using cell dimensions that don't divide evenly
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/slice",
                               json={'cellWidth': 30, 'cellHeight': 20})
        
        slice_result = response.json()
        assert slice_result['cols'] == 4  # 120 // 30
        assert slice_result['rows'] == 4  # 80 // 20
        
        # Test operations on edge cells
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/cell/15/op",
                               json={'type': 'rotate', 'degree': 90})
        assert response.status_code == 200
    
    def test_error_handling(self, test_server):
        """Test error conditions and edge cases."""
        
        # Test operations on non-existent image
        response = requests.post(f"{test_server.base_url}/api/image/fake-id/slice",
                               json={'rows': 2, 'cols': 2})
        assert response.status_code == 404
        
        # Test invalid operation
        # First create a valid image
        from PIL import Image
        test_image = Image.new('RGB', (40, 40), 'blue')
        buffer = io.BytesIO()
        test_image.save(buffer, format='PNG')
        buffer.seek(0)
        
        files = {'file': ('test.png', buffer, 'image/png')}
        response = requests.post(f"{test_server.base_url}/api/image/upload", files=files)
        image_id = response.json()['imageId']
        
        # Slice it
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/slice",
                               json={'rows': 2, 'cols': 2})
        assert response.status_code == 200
        
        # Try invalid rotation degree
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/cell/0/op",
                               json={'type': 'rotate', 'degree': 45})
        assert response.status_code == 400
        
        # Try invalid operation type
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/cell/0/op",
                               json={'type': 'invalid_op'})
        assert response.status_code == 400
    
    def test_large_grid_performance(self, test_server, fixtures_dir):
        """Test performance with larger grids."""
        
        image_path = os.path.join(fixtures_dir, 'test_large_256x256.png')
        with open(image_path, 'rb') as f:
            files = {'file': ('large.png', f, 'image/png')}
            response = requests.post(f"{test_server.base_url}/api/image/upload", files=files)
        
        image_id = response.json()['imageId']
        
        # Create 16x16 grid (256 cells)
        start_time = time.time()
        response = requests.post(f"{test_server.base_url}/api/image/{image_id}/slice",
                               json={'rows': 16, 'cols': 16})
        slice_time = time.time() - start_time
        
        assert response.status_code == 200
        assert slice_time < 2.0, "Slicing should complete within 2 seconds"
        
        # Test operations on multiple cells
        start_time = time.time()
        for cell_id in [0, 50, 100, 150, 200, 255]:
            response = requests.post(f"{test_server.base_url}/api/image/{image_id}/cell/{cell_id}/op",
                                   json={'type': 'rotate', 'degree': 90})
            assert response.status_code == 200
        operation_time = time.time() - start_time
        
        assert operation_time < 3.0, "Multiple operations should complete within 3 seconds"
        
        # Export should still work
        start_time = time.time()
        response = requests.get(f"{test_server.base_url}/api/image/{image_id}/export")
        export_time = time.time() - start_time
        
        assert response.status_code == 200
        assert export_time < 5.0, "Export should complete within 5 seconds"


if __name__ == '__main__':
    # Run integration tests
    pytest.main([__file__, '-v'])