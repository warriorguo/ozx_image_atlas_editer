use crate::store::{FitMode, Op};
use image::{imageops, DynamicImage, GenericImageView, ImageBuffer, Rgba, RgbaImage};

fn parse_hex(s: &str) -> Option<(u8, u8, u8)> {
    let s = s.trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&s[0..2], 16).ok()?;
    let g = u8::from_str_radix(&s[2..4], 16).ok()?;
    let b = u8::from_str_radix(&s[4..6], 16).ok()?;
    Some((r, g, b))
}

fn transparent(w: u32, h: u32) -> RgbaImage {
    ImageBuffer::from_pixel(w, h, Rgba([0, 0, 0, 0]))
}

fn move_cell(src: &RgbaImage, dx: i32, dy: i32) -> RgbaImage {
    let (w, h) = (src.width(), src.height());
    let mut out = transparent(w, h);
    imageops::overlay(&mut out, src, dx as i64, dy as i64);
    out
}

/// Resize bg per fit mode and place into a (cell_w, cell_h) transparent canvas.
/// Mirrors Python `_prepare_background`.
pub fn prepare_background(bg: &RgbaImage, cell_w: u32, cell_h: u32, fit: FitMode) -> RgbaImage {
    let (bw, bh) = bg.dimensions();
    let mut canvas = transparent(cell_w, cell_h);

    match fit {
        FitMode::Stretch => {
            let scaled = imageops::resize(bg, cell_w, cell_h, imageops::FilterType::Lanczos3);
            imageops::overlay(&mut canvas, &scaled, 0, 0);
        }
        FitMode::Fit => {
            let scale = (cell_w as f64 / bw as f64).min(cell_h as f64 / bh as f64);
            let nw = ((bw as f64 * scale).round() as u32).max(1);
            let nh = ((bh as f64 * scale).round() as u32).max(1);
            let scaled = imageops::resize(bg, nw, nh, imageops::FilterType::Lanczos3);
            let ox = ((cell_w as i64) - (nw as i64)) / 2;
            let oy = ((cell_h as i64) - (nh as i64)) / 2;
            imageops::overlay(&mut canvas, &scaled, ox, oy);
        }
        FitMode::Fill => {
            let scale = (cell_w as f64 / bw as f64).max(cell_h as f64 / bh as f64);
            let nw = ((bw as f64 * scale).round() as u32).max(1);
            let nh = ((bh as f64 * scale).round() as u32).max(1);
            let scaled = imageops::resize(bg, nw, nh, imageops::FilterType::Lanczos3);
            let left = (nw.saturating_sub(cell_w)) / 2;
            let top = (nh.saturating_sub(cell_h)) / 2;
            let cropped =
                imageops::crop_imm(&scaled, left, top, cell_w.min(nw), cell_h.min(nh)).to_image();
            imageops::overlay(&mut canvas, &cropped, 0, 0);
        }
    }

    canvas
}

/// Apply one op to a cell image. `get_bg` is a closure so the op layer
/// stays free of Store and is unit-testable in isolation.
pub fn apply_op(
    cell: RgbaImage,
    cell_w: u32,
    cell_h: u32,
    op: &Op,
    get_bg: &impl Fn(&str) -> Option<RgbaImage>,
) -> RgbaImage {
    match op {
        Op::Erase => transparent(cell_w, cell_h),

        Op::Rotate { degree } => match degree {
            90 => imageops::rotate90(&cell),
            180 => imageops::rotate180(&cell),
            270 => imageops::rotate270(&cell),
            _ => cell,
        },

        Op::Opacity { value } => {
            let v = value.clamp(0.0, 1.0);
            let mut out = cell;
            for px in out.pixels_mut() {
                px.0[3] = ((px.0[3] as f32 * v).round() as i32).clamp(0, 255) as u8;
            }
            out
        }

        Op::RemoveColor { color, tolerance } => {
            let Some((tr, tg, tb)) = parse_hex(color) else {
                return cell;
            };
            let tol2 = (*tolerance as f64) * (*tolerance as f64);
            let mut out = cell;
            for px in out.pixels_mut() {
                let dr = px.0[0] as f64 - tr as f64;
                let dg = px.0[1] as f64 - tg as f64;
                let db = px.0[2] as f64 - tb as f64;
                if dr * dr + dg * dg + db * db <= tol2 {
                    px.0[3] = 0;
                }
            }
            out
        }

        Op::Move { dx, dy } => move_cell(&cell, *dx, *dy),

        Op::Despill {
            amount,
            tint,
            threshold,
            softness,
        } => {
            let Some((tr, tg, tb)) = parse_hex(tint) else {
                return cell;
            };
            if *softness <= 0.0 {
                return cell;
            }
            let coef = [
                tr as f32 / 255.0,
                tg as f32 / 255.0,
                tb as f32 / 255.0,
            ];
            let mut out = cell;
            for px in out.pixels_mut() {
                // Fully transparent pixels carry no visible colour.
                if px.0[3] == 0 {
                    continue;
                }
                let (r, g, b) = (px.0[0] as f32, px.0[1] as f32, px.0[2] as f32);
                let dominance = g - r.max(b);
                let s = (((dominance - threshold) / softness).clamp(0.0, 1.0)) * amount;
                if s <= 0.0 {
                    continue;
                }
                let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                for (i, orig) in [r, g, b].iter().enumerate() {
                    let target = lum * coef[i];
                    px.0[i] = (orig * (1.0 - s) + target * s).round().clamp(0.0, 255.0) as u8;
                }
            }
            out
        }

        Op::Scale { factor } => {
            let nw = ((cell_w as f32 * factor).round() as u32).max(1);
            let nh = ((cell_h as f32 * factor).round() as u32).max(1);
            let scaled = imageops::resize(&cell, nw, nh, imageops::FilterType::Lanczos3);
            // Re-center the scaled content on the fixed cell canvas: overlay
            // crops overflow when enlarging and leaves transparency when shrinking.
            let mut canvas = transparent(cell_w, cell_h);
            let ox = ((cell_w as i64) - (nw as i64)) / 2;
            let oy = ((cell_h as i64) - (nh as i64)) / 2;
            imageops::overlay(&mut canvas, &scaled, ox, oy);
            canvas
        }

        Op::SetBackground { bg_id, fit } => match get_bg(bg_id) {
            Some(bg) => {
                let mut canvas = prepare_background(&bg, cell_w, cell_h, *fit);
                imageops::overlay(&mut canvas, &cell, 0, 0);
                canvas
            }
            None => cell,
        },
    }
}

pub fn crop_cell(src: &DynamicImage, x: u32, y: u32, w: u32, h: u32) -> RgbaImage {
    let (sw, sh) = src.dimensions();
    // Defensive clamp: never crop past the source bounds.
    let cw = w.min(sw.saturating_sub(x));
    let ch = h.min(sh.saturating_sub(y));
    src.view(x, y, cw, ch).to_image()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    fn solid(w: u32, h: u32, color: [u8; 4]) -> RgbaImage {
        ImageBuffer::from_pixel(w, h, Rgba(color))
    }

    fn no_bg(_id: &str) -> Option<RgbaImage> {
        None
    }

    #[test]
    fn erase_makes_transparent() {
        let cell = solid(10, 10, [255, 0, 0, 255]);
        let out = apply_op(cell, 10, 10, &Op::Erase, &no_bg);
        for px in out.pixels() {
            assert_eq!(px.0, [0, 0, 0, 0]);
        }
    }

    #[test]
    fn rotate_180_reverses_pixels() {
        let mut cell = solid(2, 2, [0, 0, 0, 255]);
        cell.put_pixel(0, 0, Rgba([255, 0, 0, 255])); // top-left
        let out = apply_op(cell, 2, 2, &Op::Rotate { degree: 180 }, &no_bg);
        // top-left red should be at bottom-right after 180 rotation
        assert_eq!(out.get_pixel(1, 1).0, [255, 0, 0, 255]);
    }

    #[test]
    fn opacity_half_halves_alpha() {
        let cell = solid(4, 4, [0, 0, 0, 200]);
        let out = apply_op(cell, 4, 4, &Op::Opacity { value: 0.5 }, &no_bg);
        for px in out.pixels() {
            assert_eq!(px.0[3], 100);
        }
    }

    #[test]
    fn remove_color_within_tolerance_clears_alpha() {
        let mut cell = solid(2, 2, [10, 10, 10, 255]);
        cell.put_pixel(0, 0, Rgba([255, 255, 255, 255]));
        let out = apply_op(
            cell,
            2,
            2,
            &Op::RemoveColor {
                color: "#ffffff".to_string(),
                tolerance: 5,
            },
            &no_bg,
        );
        // Pixel (0,0) was white → matches → alpha cleared
        assert_eq!(out.get_pixel(0, 0).0[3], 0);
        // Pixel (1,1) was dark gray → outside tolerance → unchanged
        assert_eq!(out.get_pixel(1, 1).0[3], 255);
    }

    #[test]
    fn move_offsets_pixels() {
        let mut cell = solid(4, 4, [0, 0, 0, 0]);
        cell.put_pixel(0, 0, Rgba([1, 2, 3, 255]));
        let out = apply_op(cell, 4, 4, &Op::Move { dx: 1, dy: 1 }, &no_bg);
        assert_eq!(out.get_pixel(0, 0).0, [0, 0, 0, 0]);
        assert_eq!(out.get_pixel(1, 1).0, [1, 2, 3, 255]);
    }

    #[test]
    fn scale_down_centers_and_pads() {
        // 8x8 opaque cell shrunk to 0.5 -> 4x4 content centered, corners transparent.
        let cell = solid(8, 8, [1, 2, 3, 255]);
        let out = apply_op(cell, 8, 8, &Op::Scale { factor: 0.5 }, &no_bg);
        assert_eq!(out.dimensions(), (8, 8));
        // Corner is outside the centered 4x4 content -> transparent.
        assert_eq!(out.get_pixel(0, 0).0[3], 0);
        // Center is covered by the scaled content.
        assert_eq!(out.get_pixel(4, 4).0[3], 255);
    }

    #[test]
    fn scale_up_crops_to_cell() {
        // Enlarging fully covers the fixed cell -> every pixel opaque.
        let cell = solid(8, 8, [10, 20, 30, 255]);
        let out = apply_op(cell, 8, 8, &Op::Scale { factor: 2.0 }, &no_bg);
        assert_eq!(out.dimensions(), (8, 8));
        for px in out.pixels() {
            assert_eq!(px.0[3], 255);
        }
    }

    fn despill(color: [u8; 4]) -> Rgba<u8> {
        let op = Op::Despill {
            amount: 1.0,
            tint: "#ffffff".to_string(),
            threshold: -3.0,
            softness: 30.0,
        };
        *apply_op(solid(2, 2, color), 2, 2, &op, &no_bg).get_pixel(0, 0)
    }

    #[test]
    fn despill_neutralizes_green() {
        // Large green dominance -> full correction -> channels end up ~equal.
        let p = despill([20, 200, 30, 255]).0;
        assert_eq!(p[3], 255);
        assert!(
            p[1].abs_diff(p[0]) <= 2 && p[1].abs_diff(p[2]) <= 2,
            "green should be neutralized, got {p:?}"
        );
    }

    #[test]
    fn despill_preserves_warm_pixel() {
        // Negative green dominance -> below threshold -> untouched.
        assert_eq!(despill([150, 110, 80, 255]).0, [150, 110, 80, 255]);
    }

    #[test]
    fn despill_leaves_transparent_pixels_untouched() {
        assert_eq!(despill([20, 200, 30, 0]).0, [20, 200, 30, 0]);
    }

    #[test]
    fn set_background_fill_composites_under_foreground() {
        // Foreground: semi-transparent green
        let cell = solid(10, 10, [0, 255, 0, 128]);
        let bg_image = solid(10, 10, [255, 0, 0, 255]);
        let get = |_id: &str| Some(bg_image.clone());
        let op = Op::SetBackground {
            bg_id: "any".to_string(),
            fit: FitMode::Fill,
        };
        let out = apply_op(cell, 10, 10, &op, &get);
        let p = out.get_pixel(5, 5).0;
        // Red bg under semi-transparent green → blended olive/yellow, ~fully opaque.
        // Allow ±1 alpha tolerance vs PIL — different rounding in the porter-duff math.
        assert!(p[3] >= 254, "alpha should be ~255, got {}", p[3]);
        assert!(p[0] > 100 && p[0] < 160, "R should be ~127, got {}", p[0]);
        assert!(p[1] > 100 && p[1] < 160, "G should be ~127, got {}", p[1]);
        assert_eq!(p[2], 0);
    }

    #[test]
    fn set_background_missing_bg_is_noop() {
        let cell = solid(4, 4, [1, 2, 3, 255]);
        let op = Op::SetBackground {
            bg_id: "missing".to_string(),
            fit: FitMode::Fill,
        };
        let out = apply_op(cell.clone(), 4, 4, &op, &no_bg);
        assert_eq!(out.get_pixel(0, 0).0, [1, 2, 3, 255]);
    }

    #[test]
    fn prepare_background_fit_keeps_aspect() {
        // 4x2 bg into 4x4 cell → fit-mode keeps it 4x2 centered, top/bottom transparent
        let bg = solid(4, 2, [255, 0, 0, 255]);
        let canvas = prepare_background(&bg, 4, 4, FitMode::Fit);
        // Top row should be transparent
        assert_eq!(canvas.get_pixel(0, 0).0[3], 0);
        // Middle rows have the bg
        assert_eq!(canvas.get_pixel(0, 1).0, [255, 0, 0, 255]);
        // Bottom transparent
        assert_eq!(canvas.get_pixel(0, 3).0[3], 0);
    }
}
