use crate::ops::{apply_op, crop_cell};
use crate::store::Store;
use image::{ImageBuffer, ImageFormat, Rgba, RgbaImage};
use std::io::Cursor;

fn encode_png(img: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img.clone())
        .write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| format!("png encode failed: {e}"))?;
    Ok(buf.into_inner())
}

pub fn render_cell_image(store: &Store, image_id: &str, cell_id: u32) -> Option<RgbaImage> {
    let src = store.images.get(image_id)?;
    let grid = store.grids.get(image_id)?;
    let row = cell_id / grid.cols;
    let col = cell_id % grid.cols;
    if row >= grid.rows {
        return None;
    }
    let x = col * grid.cell_width;
    let y = row * grid.cell_height;
    let mut cell = crop_cell(src, x, y, grid.cell_width, grid.cell_height);
    let ops = store.cell_ops_clone(image_id, cell_id);
    let get_bg = |bg_id: &str| store.backgrounds.get(bg_id).map(|b| b.to_rgba8());
    for op in &ops {
        cell = apply_op(cell, grid.cell_width, grid.cell_height, op, &get_bg);
    }
    Some(cell)
}

pub fn render_cell_png(store: &Store, image_id: &str, cell_id: u32) -> Option<Vec<u8>> {
    let img = render_cell_image(store, image_id, cell_id)?;
    encode_png(&img).ok()
}

pub fn render_atlas_png(store: &Store, image_id: &str) -> Option<Vec<u8>> {
    let grid = store.grids.get(image_id)?;
    let _ = store.images.get(image_id)?; // ensure exists
    let out_w = grid.cols * grid.cell_width;
    let out_h = grid.rows * grid.cell_height;
    let mut canvas: RgbaImage = ImageBuffer::from_pixel(out_w, out_h, Rgba([0, 0, 0, 0]));

    for row in 0..grid.rows {
        for col in 0..grid.cols {
            let cell_id = row * grid.cols + col;
            let cell = render_cell_image(store, image_id, cell_id)
                .unwrap_or_else(|| ImageBuffer::from_pixel(grid.cell_width, grid.cell_height, Rgba([0, 0, 0, 0])));
            let x = (col * grid.cell_width) as i64;
            let y = (row * grid.cell_height) as i64;
            // Direct paste (matches Python `Image.paste` semantics — no alpha compositing on top).
            for (px, py, pixel) in cell.enumerate_pixels() {
                let dx = x as u32 + px;
                let dy = y as u32 + py;
                if dx < out_w && dy < out_h {
                    canvas.put_pixel(dx, dy, *pixel);
                }
            }
        }
    }

    encode_png(&canvas).ok()
}

pub fn encode_image_png(img: &RgbaImage) -> Result<Vec<u8>, String> {
    encode_png(img)
}

#[allow(dead_code)] // exposed for symmetry; only used by image_preview command
pub fn render_image_preview_png(store: &Store, image_id: &str) -> Option<Vec<u8>> {
    let src = store.images.get(image_id)?;
    let rgba = src.to_rgba8();
    encode_png(&rgba).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{GridParams, Op, Store};
    use image::{DynamicImage, ImageBuffer, Rgba};

    fn checker_atlas(cell_w: u32, cell_h: u32, rows: u32, cols: u32) -> DynamicImage {
        let mut img = ImageBuffer::from_pixel(cell_w * cols, cell_h * rows, Rgba([0u8, 0, 0, 0]));
        for r in 0..rows {
            for c in 0..cols {
                let color = if (r + c) % 2 == 0 {
                    Rgba([255, 0, 0, 255])
                } else {
                    Rgba([0, 255, 0, 255])
                };
                for y in 0..cell_h {
                    for x in 0..cell_w {
                        img.put_pixel(c * cell_w + x, r * cell_h + y, color);
                    }
                }
            }
        }
        DynamicImage::ImageRgba8(img)
    }

    #[test]
    fn render_cell_basic_returns_correct_color() {
        let mut s = Store::new();
        let id = s.store_image(checker_atlas(10, 10, 2, 2));
        s.set_grid(
            &id,
            GridParams {
                rows: 2,
                cols: 2,
                cell_width: 10,
                cell_height: 10,
            },
        );
        let img = render_cell_image(&s, &id, 0).unwrap();
        assert_eq!(img.get_pixel(5, 5).0, [255, 0, 0, 255]);
        let img1 = render_cell_image(&s, &id, 1).unwrap();
        assert_eq!(img1.get_pixel(5, 5).0, [0, 255, 0, 255]);
    }

    #[test]
    fn render_atlas_with_erase_clears_cell() {
        let mut s = Store::new();
        let id = s.store_image(checker_atlas(10, 10, 2, 2));
        s.set_grid(
            &id,
            GridParams {
                rows: 2,
                cols: 2,
                cell_width: 10,
                cell_height: 10,
            },
        );
        s.add_cell_op(&id, 0, Op::Erase);
        let png = render_atlas_png(&s, &id).unwrap();
        let decoded = image::load_from_memory(&png).unwrap().to_rgba8();
        // Cell 0 (top-left 10x10) should now be transparent.
        assert_eq!(decoded.get_pixel(5, 5).0[3], 0);
        // Cell 1 (top-right) untouched.
        assert_eq!(decoded.get_pixel(15, 5).0, [0, 255, 0, 255]);
    }
}
