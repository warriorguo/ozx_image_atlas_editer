import pytest
import json
import io
from PIL import Image


class TestAPI:
    def test_upload_image(self, client, sample_image_bytes):
        response = client.post('/api/image/upload', data={'file': (sample_image_bytes, 'test.png')})
        
        assert response.status_code == 200
        data = response.json
        assert 'imageId' in data
        assert 'width' in data
        assert 'height' in data
        assert 'previewUrl' in data
        assert data['width'] == 100
        assert data['height'] == 100

    def test_upload_no_file(self, client):
        response = client.post('/api/image/upload')
        assert response.status_code == 400
        assert 'error' in response.json

    def test_upload_empty_filename(self, client):
        data = {'file': (io.BytesIO(b''), '')}
        response = client.post('/api/image/upload', data=data)
        assert response.status_code == 400

    def test_slice_image_by_rows_cols(self, client, uploaded_image_id):
        response = client.post(f'/api/image/{uploaded_image_id}/slice', 
                             json={'rows': 4, 'cols': 4})
        
        assert response.status_code == 200
        data = response.json
        assert data['rows'] == 4
        assert data['cols'] == 4
        assert data['cellWidth'] == 25
        assert data['cellHeight'] == 25
        assert len(data['cells']) == 16
        
        # Check first cell
        cell = data['cells'][0]
        assert cell['cellId'] == 0
        assert cell['row'] == 0
        assert cell['col'] == 0
        assert cell['x'] == 0
        assert cell['y'] == 0

    def test_slice_image_by_cell_dimensions(self, client, uploaded_image_id):
        response = client.post(f'/api/image/{uploaded_image_id}/slice', 
                             json={'cellWidth': 20, 'cellHeight': 20})
        
        assert response.status_code == 200
        data = response.json
        assert data['cellWidth'] == 20
        assert data['cellHeight'] == 20
        assert data['cols'] == 5  # 100 / 20
        assert data['rows'] == 5  # 100 / 20

    def test_slice_invalid_params(self, client, uploaded_image_id):
        response = client.post(f'/api/image/{uploaded_image_id}/slice', json={})
        assert response.status_code == 400

    def test_slice_nonexistent_image(self, client):
        response = client.post('/api/image/nonexistent/slice', 
                             json={'rows': 4, 'cols': 4})
        assert response.status_code == 404

    def test_get_image_preview(self, client, uploaded_image_id):
        response = client.get(f'/api/image/{uploaded_image_id}/preview')
        assert response.status_code == 200
        assert response.content_type == 'image/png'

    def test_get_cell_preview(self, client, uploaded_image_id):
        # First slice the image
        client.post(f'/api/image/{uploaded_image_id}/slice', 
                   json={'rows': 2, 'cols': 2})
        
        response = client.get(f'/api/image/{uploaded_image_id}/cell/0/preview')
        assert response.status_code == 200
        assert response.content_type == 'image/png'

    def test_apply_erase_operation(self, client, uploaded_image_id):
        # Slice image first
        client.post(f'/api/image/{uploaded_image_id}/slice', 
                   json={'rows': 2, 'cols': 2})
        
        response = client.post(f'/api/image/{uploaded_image_id}/cell/0/op', 
                             json={'type': 'erase'})
        assert response.status_code == 200
        assert response.json['ok'] is True

    def test_apply_rotate_operation(self, client, uploaded_image_id):
        # Slice image first
        client.post(f'/api/image/{uploaded_image_id}/slice', 
                   json={'rows': 2, 'cols': 2})
        
        response = client.post(f'/api/image/{uploaded_image_id}/cell/0/op', 
                             json={'type': 'rotate', 'degree': 90})
        assert response.status_code == 200
        assert response.json['ok'] is True

    def test_apply_invalid_rotation(self, client, uploaded_image_id):
        client.post(f'/api/image/{uploaded_image_id}/slice', 
                   json={'rows': 2, 'cols': 2})
        
        response = client.post(f'/api/image/{uploaded_image_id}/cell/0/op', 
                             json={'type': 'rotate', 'degree': 45})
        assert response.status_code == 400

    def test_apply_invalid_operation(self, client, uploaded_image_id):
        client.post(f'/api/image/{uploaded_image_id}/slice', 
                   json={'rows': 2, 'cols': 2})
        
        response = client.post(f'/api/image/{uploaded_image_id}/cell/0/op', 
                             json={'type': 'invalid'})
        assert response.status_code == 400

    def test_undo_operation(self, client, uploaded_image_id):
        # Slice and add operation
        client.post(f'/api/image/{uploaded_image_id}/slice', 
                   json={'rows': 2, 'cols': 2})
        client.post(f'/api/image/{uploaded_image_id}/cell/0/op', 
                   json={'type': 'erase'})
        
        response = client.post(f'/api/image/{uploaded_image_id}/cell/0/undo')
        assert response.status_code == 200
        assert response.json['ok'] is True

    def test_undo_no_operations(self, client, uploaded_image_id):
        client.post(f'/api/image/{uploaded_image_id}/slice', 
                   json={'rows': 2, 'cols': 2})
        
        response = client.post(f'/api/image/{uploaded_image_id}/cell/0/undo')
        assert response.status_code == 200
        assert response.json['ok'] is False

    def test_export_atlas(self, client, uploaded_image_id):
        client.post(f'/api/image/{uploaded_image_id}/slice', 
                   json={'rows': 2, 'cols': 2})
        
        response = client.get(f'/api/image/{uploaded_image_id}/export')
        assert response.status_code == 200
        assert response.content_type == 'image/png'
        assert 'attachment' in response.headers.get('Content-Disposition', '')

    def test_export_nonexistent_image(self, client):
        response = client.get('/api/image/nonexistent/export')
        assert response.status_code == 404

    def test_full_workflow(self, client, sample_image_bytes):
        # Upload
        upload_resp = client.post('/api/image/upload', 
                                data={'file': (sample_image_bytes, 'test.png')})
        image_id = upload_resp.json['imageId']
        
        # Slice
        slice_resp = client.post(f'/api/image/{image_id}/slice', 
                               json={'rows': 2, 'cols': 2})
        assert slice_resp.status_code == 200
        
        # Apply operations
        client.post(f'/api/image/{image_id}/cell/0/op', json={'type': 'erase'})
        client.post(f'/api/image/{image_id}/cell/1/op', 
                   json={'type': 'rotate', 'degree': 90})
        
        # Get cell previews
        cell0_resp = client.get(f'/api/image/{image_id}/cell/0/preview')
        cell1_resp = client.get(f'/api/image/{image_id}/cell/1/preview')
        assert cell0_resp.status_code == 200
        assert cell1_resp.status_code == 200
        
        # Export
        export_resp = client.get(f'/api/image/{image_id}/export')
        assert export_resp.status_code == 200