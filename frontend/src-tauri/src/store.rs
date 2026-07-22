use image::DynamicImage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Clone, Copy, Debug)]
pub struct GridParams {
    pub rows: u32,
    pub cols: u32,
    #[serde(rename = "cellWidth")]
    pub cell_width: u32,
    #[serde(rename = "cellHeight")]
    pub cell_height: u32,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FitMode {
    Fill,
    Fit,
    Stretch,
}

impl Default for FitMode {
    fn default() -> Self {
        FitMode::Fill
    }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Op {
    Erase,
    Rotate {
        degree: u32,
    },
    Opacity {
        value: f32,
    },
    RemoveColor {
        color: String,
        tolerance: u32,
    },
    Move {
        dx: i32,
        dy: i32,
    },
    Scale {
        factor: f32,
    },
    SetBackground {
        bg_id: String,
        #[serde(default)]
        fit: FitMode,
    },
}

#[derive(Default)]
pub struct Store {
    pub images: HashMap<String, DynamicImage>,
    pub grids: HashMap<String, GridParams>,
    pub cell_ops: HashMap<String, HashMap<u32, Vec<Op>>>,
    pub backgrounds: HashMap<String, DynamicImage>,
}

impl Store {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn store_image(&mut self, img: DynamicImage) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.images.insert(id.clone(), img);
        self.cell_ops.insert(id.clone(), HashMap::new());
        id
    }

    pub fn delete_image(&mut self, id: &str) -> bool {
        let removed = self.images.remove(id).is_some();
        self.grids.remove(id);
        self.cell_ops.remove(id);
        removed
    }

    pub fn set_grid(&mut self, id: &str, g: GridParams) {
        self.grids.insert(id.to_string(), g);
    }

    pub fn add_cell_op(&mut self, image_id: &str, cell_id: u32, op: Op) {
        self.cell_ops
            .entry(image_id.to_string())
            .or_default()
            .entry(cell_id)
            .or_default()
            .push(op);
    }

    pub fn undo_cell_op(&mut self, image_id: &str, cell_id: u32) -> bool {
        if let Some(per_image) = self.cell_ops.get_mut(image_id) {
            if let Some(stack) = per_image.get_mut(&cell_id) {
                if !stack.is_empty() {
                    stack.pop();
                    return true;
                }
            }
        }
        false
    }

    pub fn cell_ops_clone(&self, image_id: &str, cell_id: u32) -> Vec<Op> {
        self.cell_ops
            .get(image_id)
            .and_then(|m| m.get(&cell_id))
            .cloned()
            .unwrap_or_default()
    }

    pub fn store_bg(&mut self, img: DynamicImage) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.backgrounds.insert(id.clone(), img);
        id
    }

    pub fn list_bgs(&self) -> Vec<String> {
        self.backgrounds.keys().cloned().collect()
    }

    pub fn cells_with_background(&self, image_id: &str) -> Vec<u32> {
        let mut out: Vec<u32> = self
            .cell_ops
            .get(image_id)
            .map(|m| {
                m.iter()
                    .filter(|(_, ops)| ops.iter().any(|op| matches!(op, Op::SetBackground { .. })))
                    .map(|(cid, _)| *cid)
                    .collect()
            })
            .unwrap_or_default();
        out.sort_unstable();
        out
    }
}
