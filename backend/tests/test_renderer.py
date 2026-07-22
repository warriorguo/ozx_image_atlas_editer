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

    def test_render_cell_scale_down(self, sample_image):
        image_id = store.store_image(sample_image)
        grid_params = {'rows': 2, 'cols': 2, 'cellWidth': 50, 'cellHeight': 50}
        store.set_grid_params(image_id, grid_params)

        # Shrink to half size: content centered, edges padded with transparency.
        store.add_cell_op(image_id, 0, {'type': 'scale', 'factor': 0.5})

        cell_data = Renderer.render_cell(image_id, 0)
        cell_image = Image.open(io.BytesIO(cell_data))

        # Canvas stays cell-sized.
        assert cell_image.size == (50, 50)
        assert cell_image.mode == 'RGBA'
        # Corners fall outside the centered 25x25 content -> transparent.
        assert cell_image.getpixel((0, 0)) == (0, 0, 0, 0)
        assert cell_image.getpixel((49, 49)) == (0, 0, 0, 0)
        # Center still has opaque content.
        assert cell_image.getpixel((25, 25))[3] == 255

    def test_render_cell_scale_up(self, sample_image):
        image_id = store.store_image(sample_image)
        grid_params = {'rows': 2, 'cols': 2, 'cellWidth': 50, 'cellHeight': 50}
        store.set_grid_params(image_id, grid_params)

        # Enlarge 2x: overflow cropped back to the fixed cell bounds.
        store.add_cell_op(image_id, 0, {'type': 'scale', 'factor': 2.0})

        cell_data = Renderer.render_cell(image_id, 0)
        cell_image = Image.open(io.BytesIO(cell_data))

        assert cell_image.size == (50, 50)
        # Fully covered by enlarged content -> every pixel opaque.
        for pixel in cell_image.getdata():
            assert pixel[3] == 255

    def test_render_cell_scale_preserves_alpha(self, sample_image_rgba):
        image_id = store.store_image(sample_image_rgba)
        grid_params = {'rows': 1, 'cols': 1, 'cellWidth': 64, 'cellHeight': 64}
        store.set_grid_params(image_id, grid_params)

        store.add_cell_op(image_id, 0, {'type': 'scale', 'factor': 0.5})
        cell_data = Renderer.render_cell(image_id, 0)
        cell_image = Image.open(io.BytesIO(cell_data))

        assert cell_image.mode == 'RGBA'
        # The semi-transparent blue region should still carry partial alpha.
        alphas = {px[3] for px in cell_image.getdata()}
        assert any(0 < a < 255 for a in alphas)

    def _despill_cell(self, color, **overrides):
        """Render a 1-cell image of a solid colour with despill applied."""
        image = Image.new('RGBA', (4, 4), color)
        image_id = store.store_image(image)
        store.set_grid_params(image_id, {'rows': 1, 'cols': 1,
                                         'cellWidth': 4, 'cellHeight': 4})
        op = {'type': 'despill', 'amount': 1.0, 'tint': '#ffffff',
              'threshold': -3.0, 'softness': 30.0}
        op.update(overrides)
        store.add_cell_op(image_id, 0, op)
        return Image.open(io.BytesIO(Renderer.render_cell(image_id, 0))).getpixel((0, 0))

    def test_despill_neutralizes_green(self):
        # Strongly green pixel: dominance is large, so correction is full and
        # the green cast should be gone (channels ~equal at neutral tint).
        r, g, b, a = self._despill_cell((20, 200, 30, 255))
        assert a == 255
        assert abs(g - r) <= 2 and abs(g - b) <= 2, \
            f"green should be neutralized, got {(r, g, b)}"

    def test_despill_preserves_warm_pixel(self):
        # Brown/warm pixel has negative green dominance -> below threshold ->
        # untouched. This selectivity is the whole point of the ramp.
        original = (150, 110, 80, 255)
        assert self._despill_cell(original) == original

    def test_despill_amount_zero_is_noop(self):
        original = (20, 200, 30, 255)
        assert self._despill_cell(original, amount=0.0) == original

    def test_despill_leaves_transparent_pixels_untouched(self):
        # Fully transparent pixels carry no visible colour.
        original = (20, 200, 30, 0)
        assert self._despill_cell(original) == original

    def test_despill_tint_biases_result_warm(self):
        # A warm tint should push the corrected spill toward red over blue.
        r, g, b, _ = self._despill_cell((20, 200, 30, 255), tint='#996e57')
        assert r > g > b, f"expected warm bias r>g>b, got {(r, g, b)}"

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