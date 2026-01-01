import pytest
import io
from PIL import Image
from app import store, Renderer


class TestEdgeCases:
    def test_non_square_grid_slicing(self):
        """Test slicing with non-divisible dimensions"""
        # 100x100 image divided by 3x3 should use floor division
        image = Image.new('RGB', (100, 100), color='red')
        image_id = store.store_image(image)
        
        grid_params = {'rows': 3, 'cols': 3, 'cellWidth': 33, 'cellHeight': 33}
        store.set_grid_params(image_id, grid_params)
        
        # Should work with truncated cells
        cell_data = Renderer.render_cell(image_id, 0)
        assert cell_data is not None
        
        cell_image = Image.open(io.BytesIO(cell_data))
        assert cell_image.size == (33, 33)

    def test_single_cell_grid(self):
        """Test 1x1 grid"""
        image = Image.new('RGB', (50, 50), color='blue')
        image_id = store.store_image(image)
        
        grid_params = {'rows': 1, 'cols': 1, 'cellWidth': 50, 'cellHeight': 50}
        store.set_grid_params(image_id, grid_params)
        
        cell_data = Renderer.render_cell(image_id, 0)
        cell_image = Image.open(io.BytesIO(cell_data))
        assert cell_image.size == (50, 50)

    def test_rectangular_cells(self):
        """Test non-square cells"""
        image = Image.new('RGB', (100, 80), color='green')
        image_id = store.store_image(image)
        
        grid_params = {'rows': 4, 'cols': 5, 'cellWidth': 20, 'cellHeight': 20}
        store.set_grid_params(image_id, grid_params)
        
        # Test corner cells
        for cell_id in [0, 4, 15, 19]:
            cell_data = Renderer.render_cell(image_id, cell_id)
            assert cell_data is not None

    def test_rotation_non_square_cell(self):
        """Test rotation of non-square cells"""
        image = Image.new('RGB', (60, 40), color='yellow')
        # Add pattern to make rotation visible
        for i in range(20):
            for j in range(40):
                image.putpixel((i, j), (255, 0, 0))  # Red left half
        
        image_id = store.store_image(image)
        grid_params = {'rows': 2, 'cols': 3, 'cellWidth': 20, 'cellHeight': 20}
        store.set_grid_params(image_id, grid_params)
        
        # Rotate a cell 90 degrees
        store.add_cell_op(image_id, 0, {'type': 'rotate', 'degree': 90})
        
        cell_data = Renderer.render_cell(image_id, 0)
        cell_image = Image.open(io.BytesIO(cell_data))
        assert cell_image.size == (20, 20)

    def test_multiple_erase_operations(self):
        """Test that multiple erase operations work correctly"""
        image = Image.new('RGB', (40, 40), color='purple')
        image_id = store.store_image(image)
        
        grid_params = {'rows': 2, 'cols': 2, 'cellWidth': 20, 'cellHeight': 20}
        store.set_grid_params(image_id, grid_params)
        
        # Multiple erase operations (should still be transparent)
        store.add_cell_op(image_id, 0, {'type': 'erase'})
        store.add_cell_op(image_id, 0, {'type': 'erase'})
        
        cell_data = Renderer.render_cell(image_id, 0)
        cell_image = Image.open(io.BytesIO(cell_data))
        
        # Should still be fully transparent
        pixels = list(cell_image.getdata())
        for pixel in pixels:
            assert pixel == (0, 0, 0, 0)

    def test_rotation_after_erase(self):
        """Test rotating after erasing (should remain transparent)"""
        image = Image.new('RGB', (40, 40), color='cyan')
        image_id = store.store_image(image)
        
        grid_params = {'rows': 2, 'cols': 2, 'cellWidth': 20, 'cellHeight': 20}
        store.set_grid_params(image_id, grid_params)
        
        # Erase then rotate
        store.add_cell_op(image_id, 0, {'type': 'erase'})
        store.add_cell_op(image_id, 0, {'type': 'rotate', 'degree': 90})
        
        cell_data = Renderer.render_cell(image_id, 0)
        cell_image = Image.open(io.BytesIO(cell_data))
        
        # Should still be transparent
        pixels = list(cell_image.getdata())
        for pixel in pixels:
            assert pixel == (0, 0, 0, 0)

    def test_complex_operation_sequence(self):
        """Test complex sequence of operations"""
        image = Image.new('RGB', (40, 40), color='orange')
        image_id = store.store_image(image)
        
        grid_params = {'rows': 2, 'cols': 2, 'cellWidth': 20, 'cellHeight': 20}
        store.set_grid_params(image_id, grid_params)
        
        # Complex sequence
        store.add_cell_op(image_id, 0, {'type': 'rotate', 'degree': 90})
        store.add_cell_op(image_id, 0, {'type': 'rotate', 'degree': 180})
        store.add_cell_op(image_id, 0, {'type': 'rotate', 'degree': 90})  # Total: 360 degrees
        
        cell_data = Renderer.render_cell(image_id, 0)
        assert cell_data is not None

    def test_atlas_with_mixed_operations(self):
        """Test atlas rendering with different operations on each cell"""
        image = Image.new('RGB', (40, 40), color='pink')
        image_id = store.store_image(image)
        
        grid_params = {'rows': 2, 'cols': 2, 'cellWidth': 20, 'cellHeight': 20}
        store.set_grid_params(image_id, grid_params)
        
        # Different operations on each cell
        store.add_cell_op(image_id, 0, {'type': 'erase'})
        store.add_cell_op(image_id, 1, {'type': 'rotate', 'degree': 90})
        store.add_cell_op(image_id, 2, {'type': 'rotate', 'degree': 180})
        # Cell 3 remains unchanged
        
        atlas_data = Renderer.render_atlas(image_id)
        atlas_image = Image.open(io.BytesIO(atlas_data))
        
        assert atlas_image.size == (40, 40)
        
        # Check that top-left cell (0,0) is transparent
        tl_pixel = atlas_image.getpixel((0, 0))
        assert tl_pixel[3] == 0  # Alpha should be 0

    def test_large_grid(self):
        """Test with many small cells"""
        image = Image.new('RGB', (100, 100), color='brown')
        image_id = store.store_image(image)
        
        grid_params = {'rows': 10, 'cols': 10, 'cellWidth': 10, 'cellHeight': 10}
        store.set_grid_params(image_id, grid_params)
        
        # Test random cells
        for cell_id in [0, 50, 99]:
            cell_data = Renderer.render_cell(image_id, cell_id)
            assert cell_data is not None
            
            cell_image = Image.open(io.BytesIO(cell_data))
            assert cell_image.size == (10, 10)

    def test_alpha_channel_preservation(self):
        """Test that alpha channel is preserved correctly"""
        # Create image with alpha
        image = Image.new('RGBA', (40, 40), color=(255, 0, 0, 128))  # Semi-transparent red
        image_id = store.store_image(image)
        
        grid_params = {'rows': 2, 'cols': 2, 'cellWidth': 20, 'cellHeight': 20}
        store.set_grid_params(image_id, grid_params)
        
        cell_data = Renderer.render_cell(image_id, 0)
        cell_image = Image.open(io.BytesIO(cell_data))
        
        # Check that alpha is preserved
        pixel = cell_image.getpixel((10, 10))
        assert pixel[3] == 128  # Alpha should be preserved