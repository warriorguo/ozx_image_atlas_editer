import pytest
from PIL import Image
from app import store, Renderer
import io


class TestRenderer:
    def test_render_cell_basic(self, sample_image):
        image_id = store.store_image(sample_image)
        grid_params = {'rows': 4, 'cols': 4, 'cellWidth': 25, 'cellHeight': 25}
        store.set_grid_params(image_id, grid_params)
        
        cell_data = Renderer.render_cell(image_id, 0)
        assert cell_data is not None
        
        # Verify it's valid PNG data
        cell_image = Image.open(io.BytesIO(cell_data))
        assert cell_image.size == (25, 25)
        assert cell_image.mode == 'RGBA'

    def test_render_cell_with_erase(self, sample_image):
        image_id = store.store_image(sample_image)
        grid_params = {'rows': 2, 'cols': 2, 'cellWidth': 50, 'cellHeight': 50}
        store.set_grid_params(image_id, grid_params)
        
        # Add erase operation
        store.add_cell_op(image_id, 0, {'type': 'erase'})
        
        cell_data = Renderer.render_cell(image_id, 0)
        cell_image = Image.open(io.BytesIO(cell_data))
        
        # Check that the image is transparent
        pixels = list(cell_image.getdata())
        for pixel in pixels:
            assert pixel == (0, 0, 0, 0), "Erased cell should be fully transparent"

    def test_render_cell_with_rotation(self, sample_image):
        image_id = store.store_image(sample_image)
        grid_params = {'rows': 2, 'cols': 2, 'cellWidth': 50, 'cellHeight': 50}
        store.set_grid_params(image_id, grid_params)
        
        # Get original cell
        original_data = Renderer.render_cell(image_id, 0)
        original_image = Image.open(io.BytesIO(original_data))
        
        # Add rotation
        store.add_cell_op(image_id, 0, {'type': 'rotate', 'degree': 180})
        
        rotated_data = Renderer.render_cell(image_id, 0)
        rotated_image = Image.open(io.BytesIO(rotated_data))
        
        assert rotated_image.size == original_image.size
        # For 180 degree rotation, top-left should match bottom-right
        original_tl = original_image.getpixel((0, 0))
        rotated_br = rotated_image.getpixel((49, 49))
        assert original_tl == rotated_br

    def test_render_cell_multiple_operations(self, sample_image):
        image_id = store.store_image(sample_image)
        grid_params = {'rows': 2, 'cols': 2, 'cellWidth': 50, 'cellHeight': 50}
        store.set_grid_params(image_id, grid_params)
        
        # Add multiple operations
        store.add_cell_op(image_id, 0, {'type': 'rotate', 'degree': 90})
        store.add_cell_op(image_id, 0, {'type': 'rotate', 'degree': 90})
        
        cell_data = Renderer.render_cell(image_id, 0)
        assert cell_data is not None

    def test_render_atlas_basic(self, sample_image):
        image_id = store.store_image(sample_image)
        grid_params = {'rows': 2, 'cols': 2, 'cellWidth': 50, 'cellHeight': 50}
        store.set_grid_params(image_id, grid_params)
        
        atlas_data = Renderer.render_atlas(image_id)
        assert atlas_data is not None
        
        atlas_image = Image.open(io.BytesIO(atlas_data))
        assert atlas_image.size == (100, 100)  # 2x2 grid of 50x50 cells
        assert atlas_image.mode == 'RGBA'

    def test_render_atlas_with_modifications(self, sample_image):
        image_id = store.store_image(sample_image)
        grid_params = {'rows': 2, 'cols': 2, 'cellWidth': 50, 'cellHeight': 50}
        store.set_grid_params(image_id, grid_params)
        
        # Erase one cell
        store.add_cell_op(image_id, 0, {'type': 'erase'})
        # Rotate another cell
        store.add_cell_op(image_id, 1, {'type': 'rotate', 'degree': 90})
        
        atlas_data = Renderer.render_atlas(image_id)
        atlas_image = Image.open(io.BytesIO(atlas_data))
        
        # Check that cell 0 (top-left 50x50) is transparent
        tl_pixel = atlas_image.getpixel((0, 0))
        assert tl_pixel[3] == 0, "Erased cell should be transparent in atlas"

    def test_render_nonexistent_image(self):
        cell_data = Renderer.render_cell('nonexistent', 0)
        assert cell_data is None
        
        atlas_data = Renderer.render_atlas('nonexistent')
        assert atlas_data is None

    def test_render_without_grid_params(self, sample_image):
        image_id = store.store_image(sample_image)
        # Don't set grid params
        
        cell_data = Renderer.render_cell(image_id, 0)
        assert cell_data is None