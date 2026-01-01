# Atlas Image Editor

A web-based tool for editing sprite atlas images. Cut images into grids and edit individual cells with operations like erase and rotate.

## Features

- Upload images (PNG, JPG, WEBP)
  - Click to browse files or drag & drop images directly
  - Visual feedback during drag operations
- Slice images into customizable grids (rows/cols)
- Edit individual cells:
  - Erase (make transparent)
  - Rotate (90°, 180°, 270°)
  - Undo operations
- Export edited atlas as PNG
- Real-time preview with grid overlay

## Setup

### Backend (Python/Flask)
```bash
cd backend
pip install -r requirements.txt
python app.py
```

### Frontend (React)
```bash
cd frontend
npm install
npm start
```

## Usage

1. Open http://localhost:3000 in your browser
2. The backend runs on http://localhost:5001
2. Upload an image using the "Upload Image" button
3. Set the number of rows and columns for the grid
4. Click "Slice Image" to divide the image into cells
5. Click on any cell in the grid to select it
6. Use the editing tools:
   - **Erase**: Makes the selected cell transparent
   - **Rotate**: Rotates the cell by specified degrees
   - **Undo**: Reverts the last operation on the cell
7. Click "Export Atlas" to download the edited image

## API Endpoints

- `POST /api/image/upload` - Upload an image
- `POST /api/image/{id}/slice` - Slice image into grid
- `GET /api/image/{id}/cell/{cellId}/preview` - Get cell preview
- `POST /api/image/{id}/cell/{cellId}/op` - Apply operation to cell
- `POST /api/image/{id}/cell/{cellId}/undo` - Undo last operation
- `GET /api/image/{id}/export` - Export final atlas

## Technical Details

- Backend: Python 3.x with Flask and Pillow (PIL)
- Frontend: React 18 with Axios
- Image processing: Non-destructive editing with operation stacks
- Output format: PNG with alpha channel support

## Testing

The project includes comprehensive tests covering all functionality:

### Quick Test
```bash
# Run all tests
python tests/run_all_tests.py

# Check compilation only
python tests/run_all_tests.py --compile-only
```

### Individual Test Suites
```bash
# Backend unit tests
cd backend
pip install -r test_requirements.txt
python -m pytest tests/ --verbose --cov=app

# Frontend tests
cd frontend
npm install
npm test -- --coverage --watchAll=false

# Integration tests
cd tests
python -m pytest integration/ --verbose
```

### Test Coverage
- ✅ Image upload (PNG, JPG, RGBA)
- ✅ Grid slicing (rows/cols and cellWidth/cellHeight)
- ✅ Cell operations (erase, rotate 90/180/270)
- ✅ Undo functionality
- ✅ Atlas export
- ✅ Error handling and edge cases
- ✅ Performance with large grids
- ✅ Alpha channel preservation
- ✅ Non-square images and cells