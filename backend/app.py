from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from PIL import Image, ImageDraw
import io
import uuid
import os
import math
import tempfile
import atexit
import shutil
from typing import Dict, List, Optional, Tuple
import numpy as np

app = Flask(__name__)
CORS(app)

class ImageStore:
    def __init__(self):
        # Create temporary directory for storing images
        self.temp_dir = tempfile.mkdtemp(prefix='atlas_editor_')
        self.image_paths: Dict[str, str] = {}
        self.grid_params: Dict[str, dict] = {}
        self.cell_ops: Dict[str, Dict[int, List[dict]]] = {}
        self.background_paths: Dict[str, str] = {}

        # Register cleanup function
        atexit.register(self._cleanup)
    
    def _cleanup(self):
        """Clean up temporary directory on exit."""
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def store_image(self, image: Image.Image) -> str:
        image_id = str(uuid.uuid4())
        
        # Ensure RGBA mode for alpha channel support
        if image.mode != 'RGBA':
            image = image.convert('RGBA')
        
        # Save image to temporary file
        image_path = os.path.join(self.temp_dir, f"{image_id}.png")
        image.save(image_path, 'PNG')
        
        self.image_paths[image_id] = image_path
        self.cell_ops[image_id] = {}
        return image_id
    
    def get_image(self, image_id: str) -> Optional[Image.Image]:
        image_path = self.image_paths.get(image_id)
        if image_path and os.path.exists(image_path):
            return Image.open(image_path)
        return None
    
    def delete_image(self, image_id: str) -> bool:
        """Delete an image and its associated data."""
        image_path = self.image_paths.get(image_id)
        if image_path and os.path.exists(image_path):
            os.remove(image_path)
        
        # Clean up all associated data
        self.image_paths.pop(image_id, None)
        self.grid_params.pop(image_id, None)
        self.cell_ops.pop(image_id, None)
        return True
    
    def set_grid_params(self, image_id: str, params: dict):
        self.grid_params[image_id] = params
    
    def get_grid_params(self, image_id: str) -> Optional[dict]:
        return self.grid_params.get(image_id)
    
    def add_cell_op(self, image_id: str, cell_id: int, op: dict):
        if cell_id not in self.cell_ops[image_id]:
            self.cell_ops[image_id][cell_id] = []
        self.cell_ops[image_id][cell_id].append(op)
    
    def get_cell_ops(self, image_id: str, cell_id: int) -> List[dict]:
        return self.cell_ops.get(image_id, {}).get(cell_id, [])
    
    def undo_cell_op(self, image_id: str, cell_id: int) -> bool:
        if image_id in self.cell_ops and cell_id in self.cell_ops[image_id] and self.cell_ops[image_id][cell_id]:
            self.cell_ops[image_id][cell_id].pop()
            return True
        return False

    def store_background(self, image: Image.Image) -> str:
        bg_id = str(uuid.uuid4())
        if image.mode != 'RGBA':
            image = image.convert('RGBA')
        bg_path = os.path.join(self.temp_dir, f"bg_{bg_id}.png")
        image.save(bg_path, 'PNG')
        self.background_paths[bg_id] = bg_path
        return bg_id

    def get_background(self, bg_id: str) -> Optional[Image.Image]:
        bg_path = self.background_paths.get(bg_id)
        if bg_path and os.path.exists(bg_path):
            return Image.open(bg_path)
        return None

    def list_backgrounds(self) -> List[str]:
        return list(self.background_paths.keys())

    def cells_with_background(self, image_id: str) -> List[int]:
        if image_id not in self.cell_ops:
            return []
        return sorted(
            cell_id
            for cell_id, ops in self.cell_ops[image_id].items()
            if any(op.get('type') == 'set_background' for op in ops)
        )

store = ImageStore()


def _prepare_background(bg: Image.Image, cell_width: int, cell_height: int, fit: str) -> Image.Image:
    """Return a (cell_width, cell_height) RGBA canvas with bg placed per fit mode."""
    if bg.mode != 'RGBA':
        bg = bg.convert('RGBA')
    bw, bh = bg.size
    canvas = Image.new('RGBA', (cell_width, cell_height), (0, 0, 0, 0))
    if fit == 'stretch':
        canvas.paste(bg.resize((cell_width, cell_height), Image.LANCZOS), (0, 0))
    elif fit == 'fit':
        scale = min(cell_width / bw, cell_height / bh)
        new_w = max(1, int(round(bw * scale)))
        new_h = max(1, int(round(bh * scale)))
        scaled = bg.resize((new_w, new_h), Image.LANCZOS)
        canvas.paste(scaled, ((cell_width - new_w) // 2, (cell_height - new_h) // 2))
    else:  # 'fill' / cover
        scale = max(cell_width / bw, cell_height / bh)
        new_w = max(1, int(round(bw * scale)))
        new_h = max(1, int(round(bh * scale)))
        scaled = bg.resize((new_w, new_h), Image.LANCZOS)
        left = max(0, (new_w - cell_width) // 2)
        top = max(0, (new_h - cell_height) // 2)
        canvas.paste(scaled.crop((left, top, left + cell_width, top + cell_height)), (0, 0))
    return canvas


def _apply_op(cell_image: Image.Image, cell_width: int, cell_height: int, op: dict) -> Image.Image:
    op_type = op['type']
    if op_type == 'erase':
        return Image.new('RGBA', (cell_width, cell_height), (0, 0, 0, 0))
    if op_type == 'rotate':
        return cell_image.rotate(-op['degree'], expand=False, fillcolor=(0, 0, 0, 0))
    if op_type == 'opacity':
        r, g, b, a = cell_image.split()
        a = a.point(lambda x: int(x * op['value']))
        return Image.merge('RGBA', (r, g, b, a))
    if op_type == 'remove_color':
        target = tuple(int(op['color'][i:i+2], 16) for i in (1, 3, 5))
        tolerance = op['tolerance']
        arr = np.array(cell_image, dtype=np.float64)
        diff = arr[:, :, :3] - np.array(target, dtype=np.float64)
        dist = np.sqrt(np.sum(diff ** 2, axis=2))
        mask = dist <= tolerance
        arr[mask, 3] = 0
        return Image.fromarray(arr.astype(np.uint8), 'RGBA')
    if op_type == 'despill':
        # Neutralize green spill without deleting pixels (unlike remove_color,
        # which hard-cuts alpha). Green dominance drives a soft correction ramp,
        # so strongly green pixels are fully corrected while warm/brown pixels
        # barely change. Vectorized — a per-pixel loop is far too slow here.
        amount = op['amount']
        threshold = op['threshold']
        softness = op['softness']
        coef = np.array(
            [int(op['tint'][i:i+2], 16) / 255.0 for i in (1, 3, 5)],
            dtype=np.float64,
        )

        arr = np.array(cell_image, dtype=np.float64)
        rgb = arr[:, :, :3]
        r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]

        dominance = g - np.maximum(r, b)
        strength = np.clip((dominance - threshold) / softness, 0.0, 1.0) * amount
        # Fully transparent pixels carry no visible colour — leave them alone.
        strength = np.where(arr[:, :, 3] > 0, strength, 0.0)

        luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
        target = luminance[:, :, None] * coef[None, None, :]
        s = strength[:, :, None]

        arr[:, :, :3] = np.clip(np.round(rgb * (1.0 - s) + target * s), 0, 255)
        return Image.fromarray(arr.astype(np.uint8), 'RGBA')
    if op_type == 'move':
        dx, dy = op['dx'], op['dy']
        new_img = Image.new('RGBA', cell_image.size, (0, 0, 0, 0))
        new_img.paste(cell_image, (dx, dy))
        return new_img
    if op_type == 'scale':
        factor = op['factor']
        new_w = max(1, int(round(cell_width * factor)))
        new_h = max(1, int(round(cell_height * factor)))
        scaled = cell_image.resize((new_w, new_h), Image.LANCZOS)
        # Re-center the scaled content on the fixed-size cell canvas:
        # crop overflow when enlarging, pad with transparency when shrinking.
        canvas = Image.new('RGBA', (cell_width, cell_height), (0, 0, 0, 0))
        offset = ((cell_width - new_w) // 2, (cell_height - new_h) // 2)
        canvas.paste(scaled, offset)
        return canvas
    if op_type == 'set_background':
        bg = store.get_background(op['bg_id'])
        if bg is None:
            return cell_image
        canvas = _prepare_background(bg, cell_width, cell_height, op.get('fit', 'fill'))
        canvas.alpha_composite(cell_image)
        return canvas
    return cell_image

class Renderer:
    @staticmethod
    def render_cell(image_id: str, cell_id: int) -> Optional[bytes]:
        image = store.get_image(image_id)
        grid_params = store.get_grid_params(image_id)
        if not image or not grid_params:
            return None
        
        # Calculate cell position
        rows, cols = grid_params['rows'], grid_params['cols']
        cell_width, cell_height = grid_params['cellWidth'], grid_params['cellHeight']
        
        row = cell_id // cols
        col = cell_id % cols
        x = col * cell_width
        y = row * cell_height
        
        # Crop the cell from original image
        cell_image = image.crop((x, y, x + cell_width, y + cell_height))

        # Apply operations
        for op in store.get_cell_ops(image_id, cell_id):
            cell_image = _apply_op(cell_image, cell_width, cell_height, op)

        # Convert to bytes
        buffer = io.BytesIO()
        cell_image.save(buffer, format='PNG')
        return buffer.getvalue()

    @staticmethod
    def render_atlas(image_id: str) -> Optional[bytes]:
        image = store.get_image(image_id)
        grid_params = store.get_grid_params(image_id)
        if not image or not grid_params:
            return None
        
        rows, cols = grid_params['rows'], grid_params['cols']
        cell_width, cell_height = grid_params['cellWidth'], grid_params['cellHeight']
        
        # Create output image
        output_width = cols * cell_width
        output_height = rows * cell_height
        output_image = Image.new('RGBA', (output_width, output_height), (0, 0, 0, 0))
        
        # Render each cell
        for row in range(rows):
            for col in range(cols):
                cell_id = row * cols + col
                x = col * cell_width
                y = row * cell_height
                
                # Get original cell
                cell_image = image.crop((x, y, x + cell_width, y + cell_height))

                # Apply operations
                for op in store.get_cell_ops(image_id, cell_id):
                    cell_image = _apply_op(cell_image, cell_width, cell_height, op)

                # Paste into output
                output_image.paste(cell_image, (x, y))
        
        # Convert to bytes
        buffer = io.BytesIO()
        output_image.save(buffer, format='PNG')
        return buffer.getvalue()

def _validate_operation(data):
    """Validate operation data and return (op_dict, None) or (None, error_string)."""
    op_type = data.get('type')
    if op_type == 'erase':
        return {'type': 'erase'}, None
    elif op_type == 'rotate':
        degree = data.get('degree')
        if degree not in [90, 180, 270]:
            return None, 'Invalid rotation degree'
        return {'type': 'rotate', 'degree': degree}, None
    elif op_type == 'opacity':
        value = data.get('value')
        if not isinstance(value, (int, float)) or value < 0.0 or value > 1.0:
            return None, 'Opacity value must be a number between 0.0 and 1.0'
        return {'type': 'opacity', 'value': float(value)}, None
    elif op_type == 'remove_color':
        color = data.get('color')
        tolerance = data.get('tolerance')
        if not isinstance(color, str) or len(color) != 7 or color[0] != '#':
            return None, 'Color must be a hex string like #rrggbb'
        if not isinstance(tolerance, (int, float)) or tolerance < 0 or tolerance > 255:
            return None, 'Tolerance must be a number between 0 and 255'
        return {'type': 'remove_color', 'color': color, 'tolerance': int(tolerance)}, None
    elif op_type == 'move':
        dx = data.get('dx')
        dy = data.get('dy')
        if not isinstance(dx, int) or not isinstance(dy, int):
            return None, 'dx and dy must be integers'
        return {'type': 'move', 'dx': dx, 'dy': dy}, None
    elif op_type == 'despill':
        amount = data.get('amount', 1.0)
        tint = data.get('tint', '#ffffff')
        threshold = data.get('threshold', -3.0)
        softness = data.get('softness', 30.0)
        if isinstance(amount, bool) or not isinstance(amount, (int, float)):
            return None, 'Despill amount must be a number'
        if amount < 0.0 or amount > 1.0:
            return None, 'Despill amount must be between 0.0 and 1.0'
        if not isinstance(tint, str) or len(tint) != 7 or tint[0] != '#':
            return None, 'Tint must be a hex string like #rrggbb'
        try:
            int(tint[1:], 16)
        except ValueError:
            return None, 'Tint must be a hex string like #rrggbb'
        if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
            return None, 'Despill threshold must be a number'
        if isinstance(softness, bool) or not isinstance(softness, (int, float)):
            return None, 'Despill softness must be a number'
        if softness <= 0:
            return None, 'Despill softness must be greater than 0'
        return {
            'type': 'despill',
            'amount': float(amount),
            'tint': tint.lower(),
            'threshold': float(threshold),
            'softness': float(softness),
        }, None
    elif op_type == 'scale':
        factor = data.get('factor')
        if isinstance(factor, bool) or not isinstance(factor, (int, float)):
            return None, 'Scale factor must be a number'
        if factor < 0.1 or factor > 10.0:
            return None, 'Scale factor must be between 0.1 and 10.0'
        return {'type': 'scale', 'factor': float(factor)}, None
    elif op_type == 'set_background':
        bg_id = data.get('bg_id')
        fit = data.get('fit', 'fill')
        if not isinstance(bg_id, str) or not bg_id:
            return None, 'bg_id must be a non-empty string'
        if fit not in ('fit', 'fill', 'stretch'):
            return None, 'fit must be one of fit, fill, stretch'
        if store.get_background(bg_id) is None:
            return None, 'Background image not found'
        return {'type': 'set_background', 'bg_id': bg_id, 'fit': fit}, None
    else:
        return None, 'Invalid operation type'


@app.route('/api/image/upload', methods=['POST'])
def upload_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    try:
        image = Image.open(file.stream)
        image_id = store.store_image(image)
        
        return jsonify({
            'imageId': image_id,
            'width': image.width,
            'height': image.height,
            'previewUrl': f'/api/image/{image_id}/preview'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/image/<image_id>/preview')
def get_image_preview(image_id):
    # Get the stored image path directly
    image_path = store.image_paths.get(image_id)
    if not image_path or not os.path.exists(image_path):
        return 'Image not found', 404
    
    try:
        return send_file(image_path, mimetype='image/png')
    except Exception as e:
        print(f"Error serving image preview: {e}")
        return 'Error serving image', 500

@app.route('/api/image/<image_id>/slice', methods=['POST'])
def slice_image(image_id):
    image = store.get_image(image_id)
    if not image:
        return jsonify({'error': 'Image not found'}), 404
    
    data = request.json
    
    if 'rows' in data and 'cols' in data:
        rows, cols = data['rows'], data['cols']
        cell_width = image.width // cols
        cell_height = image.height // rows
    elif 'cellWidth' in data and 'cellHeight' in data:
        cell_width, cell_height = data['cellWidth'], data['cellHeight']
        cols = image.width // cell_width
        rows = image.height // cell_height
    else:
        return jsonify({'error': 'Must provide either rows/cols or cellWidth/cellHeight'}), 400
    
    # Store grid parameters
    grid_params = {
        'rows': rows,
        'cols': cols,
        'cellWidth': cell_width,
        'cellHeight': cell_height
    }
    store.set_grid_params(image_id, grid_params)
    
    # Generate cell list
    cells = []
    for row in range(rows):
        for col in range(cols):
            cell_id = row * cols + col
            cells.append({
                'cellId': cell_id,
                'row': row,
                'col': col,
                'x': col * cell_width,
                'y': row * cell_height,
                'w': cell_width,
                'h': cell_height
            })
    
    return jsonify({
        'rows': rows,
        'cols': cols,
        'cellWidth': cell_width,
        'cellHeight': cell_height,
        'cells': cells
    })

@app.route('/api/image/<image_id>/cell/<int:cell_id>/preview')
def get_cell_preview(image_id, cell_id):
    cell_data = Renderer.render_cell(image_id, cell_id)
    if not cell_data:
        return 'Cell not found', 404
    
    return send_file(io.BytesIO(cell_data), mimetype='image/png')

@app.route('/api/image/<image_id>/cell/<int:cell_id>/op', methods=['POST'])
def apply_cell_operation(image_id, cell_id):
    op, error = _validate_operation(request.json)
    if error:
        return jsonify({'error': error}), 400
    store.add_cell_op(image_id, cell_id, op)
    return jsonify({'ok': True})

@app.route('/api/image/<image_id>/cell/<int:cell_id>/undo', methods=['POST'])
def undo_cell_operation(image_id, cell_id):
    success = store.undo_cell_op(image_id, cell_id)
    return jsonify({'ok': success})

@app.route('/api/image/<image_id>/batch/op', methods=['POST'])
def batch_cell_operation(image_id):
    data = request.json
    cell_ids = data.get('cellIds', [])
    operation = data.get('operation', {})
    op, error = _validate_operation(operation)
    if error:
        return jsonify({'error': error}), 400
    for cell_id in cell_ids:
        store.add_cell_op(image_id, cell_id, op)
    return jsonify({'ok': True})

@app.route('/api/image/<image_id>/batch/undo', methods=['POST'])
def batch_undo_operation(image_id):
    data = request.json
    cell_ids = data.get('cellIds', [])
    for cell_id in cell_ids:
        store.undo_cell_op(image_id, cell_id)
    return jsonify({'ok': True})

@app.route('/api/image/<image_id>/delete', methods=['DELETE'])
def delete_image(image_id):
    success = store.delete_image(image_id)
    if success:
        return jsonify({'ok': True})
    else:
        return jsonify({'error': 'Image not found'}), 404

@app.route('/api/background/upload', methods=['POST'])
def upload_background():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    try:
        image = Image.open(file.stream)
        bg_id = store.store_background(image)
        return jsonify({
            'bgId': bg_id,
            'width': image.width,
            'height': image.height,
            'previewUrl': f'/api/background/{bg_id}/preview'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/background/<bg_id>/preview')
def get_background_preview(bg_id):
    bg_path = store.background_paths.get(bg_id)
    if not bg_path or not os.path.exists(bg_path):
        return 'Background not found', 404
    return send_file(bg_path, mimetype='image/png')


@app.route('/api/backgrounds')
def list_backgrounds():
    bgs = [
        {'bgId': bg_id, 'previewUrl': f'/api/background/{bg_id}/preview'}
        for bg_id in store.list_backgrounds()
    ]
    return jsonify({'backgrounds': bgs})


@app.route('/api/image/<image_id>/bg-cells')
def get_bg_cells(image_id):
    return jsonify({'cellIds': store.cells_with_background(image_id)})


@app.route('/api/image/<image_id>/export')
def export_atlas(image_id):
    atlas_data = Renderer.render_atlas(image_id)
    if not atlas_data:
        return 'Image not found', 404
    
    return send_file(io.BytesIO(atlas_data), mimetype='image/png', as_attachment=True, download_name=f'atlas_{image_id}.png')

if __name__ == '__main__':
    app.run(debug=True, port=5001)