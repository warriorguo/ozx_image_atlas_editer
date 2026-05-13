mod commands;
mod ops;
mod render;
mod store;

use std::sync::Mutex;
use store::Store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Mutex::new(Store::new()))
        .invoke_handler(tauri::generate_handler![
            commands::image_load_bytes,
            commands::image_delete,
            commands::image_slice,
            commands::image_preview,
            commands::cell_preview,
            commands::cell_op,
            commands::cell_undo,
            commands::batch_cell_op,
            commands::batch_cell_undo,
            commands::atlas_export,
            commands::background_upload_bytes,
            commands::background_preview,
            commands::backgrounds_list,
            commands::image_bg_cells,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
