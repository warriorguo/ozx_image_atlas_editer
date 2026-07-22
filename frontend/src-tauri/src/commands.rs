use crate::render::{render_atlas_png, render_cell_png, render_image_preview_png};
use crate::store::{GridParams, Op, Store};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

type StoreState<'a> = State<'a, Mutex<Store>>;

#[derive(Serialize)]
pub struct ImageInfo {
    #[serde(rename = "imageId")]
    pub image_id: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize)]
pub struct Cell {
    #[serde(rename = "cellId")]
    pub cell_id: u32,
    pub row: u32,
    pub col: u32,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Serialize)]
pub struct SliceResult {
    pub rows: u32,
    pub cols: u32,
    #[serde(rename = "cellWidth")]
    pub cell_width: u32,
    #[serde(rename = "cellHeight")]
    pub cell_height: u32,
    pub cells: Vec<Cell>,
}

#[derive(Serialize)]
pub struct BackgroundInfo {
    #[serde(rename = "bgId")]
    pub bg_id: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize)]
pub struct BackgroundEntry {
    #[serde(rename = "bgId")]
    pub bg_id: String,
}

fn lock<'a>(state: &'a StoreState) -> Result<std::sync::MutexGuard<'a, Store>, String> {
    state.lock().map_err(|e| format!("store lock poisoned: {e}"))
}

#[tauri::command]
pub fn image_load_bytes(bytes: Vec<u8>, state: StoreState) -> Result<ImageInfo, String> {
    let img = image::load_from_memory(&bytes).map_err(|e| format!("decode failed: {e}"))?;
    let (w, h) = (img.width(), img.height());
    let img = image::DynamicImage::ImageRgba8(img.to_rgba8());
    let mut s = lock(&state)?;
    let id = s.store_image(img);
    Ok(ImageInfo {
        image_id: id,
        width: w,
        height: h,
    })
}

#[tauri::command]
pub fn image_delete(image_id: String, state: StoreState) -> Result<bool, String> {
    Ok(lock(&state)?.delete_image(&image_id))
}

#[tauri::command]
pub fn image_slice(
    image_id: String,
    rows: Option<u32>,
    cols: Option<u32>,
    cell_width: Option<u32>,
    cell_height: Option<u32>,
    state: StoreState,
) -> Result<SliceResult, String> {
    let mut s = lock(&state)?;
    let (iw, ih) = {
        let img = s
            .images
            .get(&image_id)
            .ok_or_else(|| "image not found".to_string())?;
        (img.width(), img.height())
    };

    let (rows, cols, cw, ch) = match (rows, cols, cell_width, cell_height) {
        (Some(r), Some(c), _, _) if r > 0 && c > 0 => (r, c, iw / c, ih / r),
        (_, _, Some(cw), Some(ch)) if cw > 0 && ch > 0 => (ih / ch, iw / cw, cw, ch),
        _ => return Err("must provide either rows/cols or cellWidth/cellHeight".to_string()),
    };

    s.set_grid(
        &image_id,
        GridParams {
            rows,
            cols,
            cell_width: cw,
            cell_height: ch,
        },
    );

    let mut cells = Vec::with_capacity((rows * cols) as usize);
    for r in 0..rows {
        for c in 0..cols {
            cells.push(Cell {
                cell_id: r * cols + c,
                row: r,
                col: c,
                x: c * cw,
                y: r * ch,
                w: cw,
                h: ch,
            });
        }
    }

    Ok(SliceResult {
        rows,
        cols,
        cell_width: cw,
        cell_height: ch,
        cells,
    })
}

#[tauri::command]
pub fn image_preview(image_id: String, state: StoreState) -> Result<tauri::ipc::Response, String> {
    let s = lock(&state)?;
    let png = render_image_preview_png(&s, &image_id).ok_or("image not found")?;
    Ok(tauri::ipc::Response::new(png))
}

#[tauri::command]
pub fn cell_preview(
    image_id: String,
    cell_id: u32,
    state: StoreState,
) -> Result<tauri::ipc::Response, String> {
    let s = lock(&state)?;
    let png = render_cell_png(&s, &image_id, cell_id).ok_or("cell not found")?;
    Ok(tauri::ipc::Response::new(png))
}

#[tauri::command]
pub fn cell_op(
    image_id: String,
    cell_id: u32,
    operation: Op,
    state: StoreState,
) -> Result<bool, String> {
    let mut s = lock(&state)?;
    validate_op(&operation, &s)?;
    s.add_cell_op(&image_id, cell_id, operation);
    Ok(true)
}

#[tauri::command]
pub fn cell_undo(image_id: String, cell_id: u32, state: StoreState) -> Result<bool, String> {
    Ok(lock(&state)?.undo_cell_op(&image_id, cell_id))
}

#[tauri::command]
pub fn batch_cell_op(
    image_id: String,
    cell_ids: Vec<u32>,
    operation: Op,
    state: StoreState,
) -> Result<bool, String> {
    let mut s = lock(&state)?;
    validate_op(&operation, &s)?;
    for cid in cell_ids {
        s.add_cell_op(&image_id, cid, operation.clone());
    }
    Ok(true)
}

#[tauri::command]
pub fn batch_cell_undo(
    image_id: String,
    cell_ids: Vec<u32>,
    state: StoreState,
) -> Result<bool, String> {
    let mut s = lock(&state)?;
    for cid in cell_ids {
        s.undo_cell_op(&image_id, cid);
    }
    Ok(true)
}

#[tauri::command]
pub fn atlas_export(image_id: String, state: StoreState) -> Result<tauri::ipc::Response, String> {
    let s = lock(&state)?;
    let png = render_atlas_png(&s, &image_id).ok_or("image not found")?;
    Ok(tauri::ipc::Response::new(png))
}

#[tauri::command]
pub fn background_upload_bytes(
    bytes: Vec<u8>,
    state: StoreState,
) -> Result<BackgroundInfo, String> {
    let img = image::load_from_memory(&bytes).map_err(|e| format!("decode failed: {e}"))?;
    let (w, h) = (img.width(), img.height());
    let img = image::DynamicImage::ImageRgba8(img.to_rgba8());
    let mut s = lock(&state)?;
    let id = s.store_bg(img);
    Ok(BackgroundInfo {
        bg_id: id,
        width: w,
        height: h,
    })
}

#[tauri::command]
pub fn background_preview(
    bg_id: String,
    state: StoreState,
) -> Result<tauri::ipc::Response, String> {
    let s = lock(&state)?;
    let bg = s.backgrounds.get(&bg_id).ok_or("background not found")?;
    let rgba = bg.to_rgba8();
    let png = crate::render::encode_image_png(&rgba)?;
    Ok(tauri::ipc::Response::new(png))
}

#[tauri::command]
pub fn backgrounds_list(state: StoreState) -> Result<Vec<BackgroundEntry>, String> {
    Ok(lock(&state)?
        .list_bgs()
        .into_iter()
        .map(|bg_id| BackgroundEntry { bg_id })
        .collect())
}

#[tauri::command]
pub fn image_bg_cells(image_id: String, state: StoreState) -> Result<Vec<u32>, String> {
    Ok(lock(&state)?.cells_with_background(&image_id))
}

/// Mirror Python `_validate_operation` — reject ops the renderer can't safely run.
fn validate_op(op: &Op, store: &Store) -> Result<(), String> {
    match op {
        Op::Rotate { degree } if ![90, 180, 270].contains(degree) => {
            Err(format!("invalid rotation degree: {degree}"))
        }
        Op::Opacity { value } if !(0.0..=1.0).contains(value) => {
            Err("opacity value must be between 0.0 and 1.0".to_string())
        }
        Op::Scale { factor } if !(0.1..=10.0).contains(factor) => {
            Err("scale factor must be between 0.1 and 10.0".to_string())
        }
        Op::Despill {
            amount,
            tint,
            softness,
            ..
        } => {
            if !(0.0..=1.0).contains(amount) {
                return Err("despill amount must be between 0.0 and 1.0".to_string());
            }
            if tint.len() != 7 || !tint.starts_with('#') {
                return Err("tint must be a hex string like #rrggbb".to_string());
            }
            if *softness <= 0.0 {
                return Err("despill softness must be greater than 0".to_string());
            }
            Ok(())
        }
        Op::RemoveColor { color, tolerance } => {
            if color.len() != 7 || !color.starts_with('#') {
                return Err("color must be a hex string like #rrggbb".to_string());
            }
            if *tolerance > 255 {
                return Err("tolerance must be <= 255".to_string());
            }
            Ok(())
        }
        Op::SetBackground { bg_id, .. } => {
            if !store.backgrounds.contains_key(bg_id) {
                return Err("background image not found".to_string());
            }
            Ok(())
        }
        _ => Ok(()),
    }
}
