# Atlas Image Editor Tests

This directory contains comprehensive tests for the Atlas Image Editor project.

## Test Structure

```
tests/
├── fixtures/                    # Test image fixtures
│   ├── create_test_images.py   # Script to generate test images
│   └── *.png, *.jpg            # Generated test images
├── integration/                 # Integration tests
│   └── test_full_workflow.py   # End-to-end workflow tests
└── run_all_tests.py            # Test runner script
```

## Backend Tests

Located in `backend/tests/`:

- `test_image_store.py` - Tests for ImageStore class
- `test_renderer.py` - Tests for Renderer class  
- `test_api.py` - API endpoint tests
- `test_edge_cases.py` - Edge cases and error conditions
- `conftest.py` - Test fixtures and configuration

### Running Backend Tests

```bash
cd backend
pip install -r test_requirements.txt
python -m pytest tests/ --verbose --cov=app
```

## Frontend Tests

Located in `frontend/src/__tests__/`:

- `App.test.js` - React component tests
- `setupTests.js` - Test configuration

### Running Frontend Tests

```bash
cd frontend
npm install
npm test -- --coverage --watchAll=false
```

## Integration Tests

Located in `tests/integration/`:

- `test_full_workflow.py` - Complete end-to-end workflow tests

### Running Integration Tests

```bash
cd tests
python -m pytest integration/ --verbose
```

## Test Fixtures

Test images are generated automatically by the `create_test_images.py` script:

- `test_rgb_100x100.png` - Standard RGB image with grid
- `test_rgba_64x64.png` - RGBA image with transparency
- `test_large_256x256.png` - Large image for performance testing
- `test_rect_120x80.png` - Non-square image
- `test_rotation_50x50.png` - Image with rotation test pattern
- `test_mini_16x16.png` - Minimal size image
- `test_jpg_80x80.jpg` - JPEG format test

## Running All Tests

Use the comprehensive test runner:

```bash
python tests/run_all_tests.py
```

Options:
- `--backend` - Run only backend tests
- `--frontend` - Run only frontend tests  
- `--integration` - Run only integration tests
- `--compile-only` - Check compilation without running tests
- `--skip-deps` - Skip dependency checks

## Test Coverage

The tests cover:

### Functionality
- ✅ Image upload (PNG, JPG, RGBA)
- ✅ Grid slicing (rows/cols and cellWidth/cellHeight)
- ✅ Cell operations (erase, rotate 90/180/270)
- ✅ Undo functionality
- ✅ Atlas export
- ✅ Error handling

### Edge Cases
- ✅ Non-divisible grid dimensions
- ✅ Non-square images and cells
- ✅ Alpha channel preservation
- ✅ Multiple operations on same cell
- ✅ Large grids (performance)
- ✅ Minimal size images
- ✅ Invalid input handling

### UI Components
- ✅ File upload interface
- ✅ Grid parameter controls
- ✅ Cell selection and preview
- ✅ Operation buttons
- ✅ Export functionality
- ✅ Error states

## Acceptance Criteria Verification

The tests verify all original requirements:

1. **512×512 PNG, 8×8 grid (64×64 cells)** ✅
2. **Erase operation results in transparent cells** ✅
3. **Rotation operations (90/180/270 degrees)** ✅
4. **Undo/redo functionality** ✅
5. **Export atlas matches cell edits** ✅
6. **Edge handling (floor division for grid sizing)** ✅
7. **Alpha channel support for transparent operations** ✅

## Performance Benchmarks

Integration tests include performance checks:
- Grid slicing: < 2 seconds for 16×16 grid
- Multiple operations: < 3 seconds for 6 operations  
- Atlas export: < 5 seconds for 256-cell atlas