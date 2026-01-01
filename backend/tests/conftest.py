import pytest
import tempfile
import io
from PIL import Image
from app import app, store


@pytest.fixture
def client():
    app.config['TESTING'] = True
    # Clear store data
    store.image_paths.clear()
    store.grid_params.clear()
    store.cell_ops.clear()
    
    with app.test_client() as client:
        yield client


@pytest.fixture
def sample_image():
    """Create a test image (100x100 RGB)"""
    image = Image.new('RGB', (100, 100), color='red')
    # Add some pattern to make rotation testing meaningful
    for i in range(0, 100, 10):
        for j in range(i, i+5):
            if j < 100:
                for k in range(100):
                    image.putpixel((j, k), (0, 255, 0))  # Green stripes
    return image


@pytest.fixture
def sample_image_rgba():
    """Create a test RGBA image (64x64)"""
    image = Image.new('RGBA', (64, 64), color=(255, 0, 0, 255))
    # Add alpha channel test pattern
    for i in range(32):
        for j in range(32):
            image.putpixel((i, j), (0, 0, 255, 128))  # Semi-transparent blue
    return image


@pytest.fixture
def sample_image_bytes():
    """Get sample image as bytes"""
    image = Image.new('RGB', (100, 100), color='blue')
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    buffer.seek(0)
    return buffer


@pytest.fixture
def uploaded_image_id(client, sample_image_bytes):
    """Upload an image and return its ID"""
    response = client.post('/api/image/upload', data={'file': (sample_image_bytes, 'test.png')})
    return response.json['imageId']