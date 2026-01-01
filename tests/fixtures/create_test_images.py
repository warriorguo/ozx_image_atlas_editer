#!/usr/bin/env python3
"""
Script to create test image fixtures for the Atlas Image Editor tests.
"""

import os
from PIL import Image, ImageDraw, ImageFont
import io


def create_test_images():
    """Create various test images for different test scenarios."""
    
    fixtures_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 1. Simple RGB test image (100x100)
    img1 = Image.new('RGB', (100, 100), color='red')
    draw = ImageDraw.Draw(img1)
    # Add grid pattern
    for i in range(0, 100, 20):
        draw.line([(i, 0), (i, 100)], fill='white', width=1)
        draw.line([(0, i), (100, i)], fill='white', width=1)
    img1.save(os.path.join(fixtures_dir, 'test_rgb_100x100.png'))
    
    # 2. RGBA test image with transparency (64x64)
    img2 = Image.new('RGBA', (64, 64), color=(0, 0, 255, 255))
    draw = ImageDraw.Draw(img2)
    # Add transparent checkerboard pattern
    for i in range(0, 64, 8):
        for j in range(0, 64, 8):
            if (i//8 + j//8) % 2:
                draw.rectangle([i, j, i+8, j+8], fill=(255, 255, 255, 128))
    img2.save(os.path.join(fixtures_dir, 'test_rgba_64x64.png'))
    
    # 3. Large test image (256x256)
    img3 = Image.new('RGB', (256, 256), color='green')
    draw = ImageDraw.Draw(img3)
    # Add diagonal stripes
    for i in range(-256, 512, 32):
        draw.line([(i, 0), (i+256, 256)], fill='yellow', width=4)
    img3.save(os.path.join(fixtures_dir, 'test_large_256x256.png'))
    
    # 4. Non-square image (120x80)
    img4 = Image.new('RGB', (120, 80), color='purple')
    draw = ImageDraw.Draw(img4)
    # Add gradient
    for i in range(120):
        color_val = int(255 * i / 120)
        draw.line([(i, 0), (i, 80)], fill=(color_val, 0, 255-color_val))
    img4.save(os.path.join(fixtures_dir, 'test_rect_120x80.png'))
    
    # 5. Square image with pattern for rotation testing (50x50)
    img5 = Image.new('RGB', (50, 50), color='white')
    draw = ImageDraw.Draw(img5)
    # Add arrow pattern to test rotation
    draw.polygon([(25, 10), (40, 25), (30, 25), (30, 40), (20, 40), (20, 25), (10, 25)], 
                fill='black')
    img5.save(os.path.join(fixtures_dir, 'test_rotation_50x50.png'))
    
    # 6. Minimal image (16x16)
    img6 = Image.new('RGB', (16, 16))
    pixels = img6.load()
    # Create unique pattern in each 4x4 quadrant
    colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)]
    for i in range(16):
        for j in range(16):
            quad = (i//8) * 2 + (j//8)
            pixels[i, j] = colors[quad]
    img6.save(os.path.join(fixtures_dir, 'test_mini_16x16.png'))
    
    # 7. JPG test image (no alpha)
    img7 = Image.new('RGB', (80, 80), color='orange')
    draw = ImageDraw.Draw(img7)
    draw.ellipse([10, 10, 70, 70], fill='red', outline='black', width=2)
    img7.save(os.path.join(fixtures_dir, 'test_jpg_80x80.jpg'))
    
    print("Test fixtures created successfully!")


if __name__ == '__main__':
    create_test_images()