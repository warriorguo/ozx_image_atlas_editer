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

app = Flask(__name__)
CORS(app)

class ImageStore:
    def __init__(self):
        # Create temporary directory for storing images
        self.temp_dir = tempfile.mkdtemp(prefix='atlas_editor_')
        self.image_paths: Dict[str, str] = {}
        self.grid_params: Dict[str, dict] = {}
        self.cell_ops: Dict[str, Dict[int, List[dict]]] = {}
        
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

store = ImageStore()

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
        ops = store.get_cell_ops(image_id, cell_id)
        for op in ops:
            if op['type'] == 'erase':
                # Create transparent image
                cell_image = Image.new('RGBA', (cell_width, cell_height), (0, 0, 0, 0))
            elif op['type'] == 'rotate':
                degree = op['degree']
                cell_image = cell_image.rotate(-degree, expand=False, fillcolor=(0, 0, 0, 0))
        
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
                ops = store.get_cell_ops(image_id, cell_id)
                for op in ops:
                    if op['type'] == 'erase':
                        cell_image = Image.new('RGBA', (cell_width, cell_height), (0, 0, 0, 0))
                    elif op['type'] == 'rotate':
                        degree = op['degree']
                        cell_image = cell_image.rotate(-degree, expand=False, fillcolor=(0, 0, 0, 0))
                
                # Paste into output
                output_image.paste(cell_image, (x, y))
        
        # Convert to bytes
        buffer = io.BytesIO()
        output_image.save(buffer, format='PNG')
        return buffer.getvalue()

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
    data = request.json
    op_type = data.get('type')
    
    if op_type == 'erase':
        op = {'type': 'erase'}
    elif op_type == 'rotate':
        degree = data.get('degree')
        if degree not in [90, 180, 270]:
            return jsonify({'error': 'Invalid rotation degree'}), 400
        op = {'type': 'rotate', 'degree': degree}
    else:
        return jsonify({'error': 'Invalid operation type'}), 400
    
    store.add_cell_op(image_id, cell_id, op)
    return jsonify({'ok': True})

@app.route('/api/image/<image_id>/cell/<int:cell_id>/undo', methods=['POST'])
def undo_cell_operation(image_id, cell_id):
    success = store.undo_cell_op(image_id, cell_id)
    return jsonify({'ok': success})

@app.route('/api/image/<image_id>/delete', methods=['DELETE'])
def delete_image(image_id):
    success = store.delete_image(image_id)
    if success:
        return jsonify({'ok': True})
    else:
        return jsonify({'error': 'Image not found'}), 404

@app.route('/api/image/<image_id>/export')
def export_atlas(image_id):
    atlas_data = Renderer.render_atlas(image_id)
    if not atlas_data:
        return 'Image not found', 404
    
    return send_file(io.BytesIO(atlas_data), mimetype='image/png', as_attachment=True, download_name=f'atlas_{image_id}.png')

if __name__ == '__main__':
    app.run(debug=True, port=5001)