import pytest
from PIL import Image
from app import ImageStore


class TestImageStore:
    def test_store_image_rgb(self, sample_image):
        store = ImageStore()
        image_id = store.store_image(sample_image)
        
        assert image_id is not None
        assert len(image_id) > 0
        assert image_id in store.image_paths
        
        stored_image = store.get_image(image_id)
        assert stored_image.mode == 'RGBA'  # Should convert to RGBA
        assert stored_image.size == (100, 100)

    def test_store_image_rgba(self, sample_image_rgba):
        store = ImageStore()
        image_id = store.store_image(sample_image_rgba)
        
        stored_image = store.get_image(image_id)
        assert stored_image.mode == 'RGBA'
        assert stored_image.size == (64, 64)

    def test_get_nonexistent_image(self):
        store = ImageStore()
        assert store.get_image('nonexistent') is None

    def test_grid_params(self, sample_image):
        store = ImageStore()
        image_id = store.store_image(sample_image)
        
        params = {'rows': 4, 'cols': 4, 'cellWidth': 25, 'cellHeight': 25}
        store.set_grid_params(image_id, params)
        
        retrieved_params = store.get_grid_params(image_id)
        assert retrieved_params == params

    def test_cell_operations(self, sample_image):
        store = ImageStore()
        image_id = store.store_image(sample_image)
        
        # Add operations
        op1 = {'type': 'erase'}
        op2 = {'type': 'rotate', 'degree': 90}
        
        store.add_cell_op(image_id, 0, op1)
        store.add_cell_op(image_id, 0, op2)
        
        ops = store.get_cell_ops(image_id, 0)
        assert len(ops) == 2
        assert ops[0] == op1
        assert ops[1] == op2

    def test_undo_operation(self, sample_image):
        store = ImageStore()
        image_id = store.store_image(sample_image)
        
        op1 = {'type': 'erase'}
        op2 = {'type': 'rotate', 'degree': 90}
        
        store.add_cell_op(image_id, 0, op1)
        store.add_cell_op(image_id, 0, op2)
        
        # Undo last operation
        success = store.undo_cell_op(image_id, 0)
        assert success is True
        
        ops = store.get_cell_ops(image_id, 0)
        assert len(ops) == 1
        assert ops[0] == op1

    def test_undo_empty_operations(self, sample_image):
        store = ImageStore()
        image_id = store.store_image(sample_image)
        
        # Try to undo with no operations
        success = store.undo_cell_op(image_id, 0)
        assert success is False

    def test_get_cell_ops_nonexistent(self):
        store = ImageStore()
        ops = store.get_cell_ops('nonexistent', 0)
        assert ops == []