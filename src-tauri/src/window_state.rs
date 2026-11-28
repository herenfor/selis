//! Remember the last normal desktop window size.
//!
//! Only the logical width and height are persisted. Position and monitor
//! identity are deliberately excluded: restoring those safely differs by
//! platform (Wayland, for example, does not let a client choose an absolute
//! window position), while the size alone keeps startup behaviour predictable.
//!
//! The desktop window is created hidden so the saved size can be applied
//! before the first paint. It is always shown by [`restore`], including on the
//! first run and when reading or applying the saved size fails.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::window::Color;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalSize, Theme, WebviewWindow, WindowEvent};

const STORE_FILE: &str = "window-size.json";
const SCHEMA_VERSION: u32 = 1;
const MIN_WIDTH: u32 = 640;
const MIN_HEIGHT: u32 = 480;
const MAX_DIMENSION: u32 = 16_384;
const MAX_STORE_BYTES: u64 = 4 * 1024;

#[derive(Default)]
pub(crate) struct WindowSizeState {
    last_normal: Mutex<Option<Dimensions>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Dimensions {
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredWindowSize {
    schema_version: u32,
    width: u32,
    height: u32,
}

/// Restore the saved size before showing the window, then centre it.
///
/// There is intentionally no saved position to restore. Centring avoids
/// resizing from a stale corner when the previous monitor is no longer present.
/// The window is hidden until this function finishes, so applying the saved
/// size cannot be observed as a startup resize/flicker.
pub(crate) fn restore(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // The startup placeholder already follows `prefers-color-scheme`; match it
    // behind the webview so a dark-mode first frame cannot flash white before
    // the page paints. Best effort: a rejected colour must not block showing.
    let dark = matches!(window.theme(), Ok(Theme::Dark));
    let _ = window.set_background_color(Some(startup_background(dark)));
    restore_window(
        &TauriRestoreWindow { window: &window },
        read_saved_size(app),
    );
}

/// Background behind the webview before the first paint, matching index.html's
/// startup placeholder (dark `#1e1e1e`, light `#ffffff`).
fn startup_background(dark: bool) -> Color {
    if dark {
        Color(30, 30, 30, 255)
    } else {
        Color(255, 255, 255, 255)
    }
}

trait RestoreWindow {
    fn work_area_limit(&self) -> Option<Dimensions>;
    fn set_size(&self, size: Dimensions) -> bool;
    fn center(&self);
    fn show(&self);
}

struct TauriRestoreWindow<'a> {
    window: &'a WebviewWindow,
}

impl RestoreWindow for TauriRestoreWindow<'_> {
    fn work_area_limit(&self) -> Option<Dimensions> {
        current_work_area_limit(self.window)
    }

    fn set_size(&self, size: Dimensions) -> bool {
        self.window
            .set_size(LogicalSize::new(size.width, size.height))
            .is_ok()
    }

    fn center(&self) {
        let _ = self.window.center();
    }

    fn show(&self) {
        let _ = self.window.show();
    }
}

fn restore_window(window: &impl RestoreWindow, saved: Option<Dimensions>) {
    if let Some(size) = saved.map(|saved| clamp_dimensions(saved, window.work_area_limit())) {
        if window.set_size(size) {
            window.center();
        }
    }
    // Showing is unconditional: a missing/corrupt size file, a monitor lookup
    // failure or a rejected resize must never leave the hidden window stuck.
    window.show();
}

/// Track normal sizes and flush when the main window closes or the app exits.
pub(crate) fn handle_window_event(app: &AppHandle, event: &WindowEvent) {
    match event {
        WindowEvent::Resized(size) => remember_physical_size(app, *size, None),
        WindowEvent::ScaleFactorChanged {
            scale_factor,
            new_inner_size,
            ..
        } => remember_physical_size(app, *new_inner_size, Some(*scale_factor)),
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            remember_current_size(app);
            persist(app);
        }
        _ => {}
    }
}

/// The frontend can call `destroy()` instead of `close()`, so also flush on
/// `RunEvent::Exit` where a close request may never have reached the backend.
pub(crate) fn save_on_exit(app: &AppHandle) {
    remember_current_size(app);
    persist(app);
}

fn read_saved_size(app: &AppHandle) -> Option<Dimensions> {
    let path = store_path(app)?;
    let metadata = fs::metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_STORE_BYTES {
        return None;
    }
    let raw = fs::read_to_string(&path).ok()?;
    decode_saved_size(&raw)
}

fn decode_saved_size(raw: &str) -> Option<Dimensions> {
    let stored: StoredWindowSize = serde_json::from_str(raw).ok()?;
    if stored.schema_version != SCHEMA_VERSION || stored.width == 0 || stored.height == 0 {
        return None;
    }
    Some(Dimensions {
        width: stored.width,
        height: stored.height,
    })
}

fn remember_current_size(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if !is_normal_window(&window) {
        return;
    }
    let Ok(size) = window.inner_size() else {
        return;
    };
    remember_physical_size(app, size, window.scale_factor().ok());
}

fn remember_physical_size(app: &AppHandle, size: PhysicalSize<u32>, scale: Option<f64>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // Maximised, full-screen and minimised sizes must never replace the last
    // size the user actually chose for a normal window.
    if !is_normal_window(&window) {
        return;
    }
    let scale = scale
        .filter(|value| value.is_finite() && *value > 0.0)
        .or_else(|| {
            window
                .scale_factor()
                .ok()
                .filter(|value| value.is_finite() && *value > 0.0)
        })
        .unwrap_or(1.0);
    let Some(size) = logical_size_from_physical(size, scale) else {
        return;
    };
    if let Ok(mut last_normal) = app.state::<WindowSizeState>().last_normal.lock() {
        *last_normal = Some(size);
    }
}

fn is_normal_window(window: &WebviewWindow) -> bool {
    matches!(
        (
            window.is_maximized(),
            window.is_minimized(),
            window.is_fullscreen()
        ),
        (Ok(false), Ok(false), Ok(false))
    )
}

fn persist(app: &AppHandle) {
    let Some(size) = app
        .state::<WindowSizeState>()
        .last_normal
        .lock()
        .ok()
        .and_then(|last_normal| *last_normal)
    else {
        return;
    };
    let Some(path) = store_path(app) else {
        return;
    };
    let stored = StoredWindowSize {
        schema_version: SCHEMA_VERSION,
        width: size.width,
        height: size.height,
    };
    let Ok(mut bytes) = serde_json::to_vec_pretty(&stored) else {
        return;
    };
    bytes.push(b'\n');
    if let Err(error) = crate::linked_library::atomic_write_bytes(&path, &bytes) {
        eprintln!("无法保存窗口尺寸：{error}");
    }
}

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|root| root.join(STORE_FILE))
}

fn current_work_area_limit(window: &WebviewWindow) -> Option<Dimensions> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;
    logical_work_area_limit(monitor.work_area().size, monitor.scale_factor())
}

fn logical_work_area_limit(area: PhysicalSize<u32>, scale: f64) -> Option<Dimensions> {
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let width = (area.width as f64 / scale).floor();
    let height = (area.height as f64 / scale).floor();
    if width < 1.0 || height < 1.0 {
        return None;
    }
    Some(Dimensions {
        width: width as u32,
        height: height as u32,
    })
}

fn logical_size_from_physical(size: PhysicalSize<u32>, scale: f64) -> Option<Dimensions> {
    if size.width == 0 || size.height == 0 || !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let width = (size.width as f64 / scale).round();
    let height = (size.height as f64 / scale).round();
    if width < 1.0 || height < 1.0 {
        return None;
    }
    Some(Dimensions {
        width: clamp_dimension(width as u32, MIN_WIDTH, None),
        height: clamp_dimension(height as u32, MIN_HEIGHT, None),
    })
}

fn clamp_dimensions(size: Dimensions, limit: Option<Dimensions>) -> Dimensions {
    Dimensions {
        width: clamp_dimension(size.width, MIN_WIDTH, limit.map(|value| value.width)),
        height: clamp_dimension(size.height, MIN_HEIGHT, limit.map(|value| value.height)),
    }
}

fn clamp_dimension(value: u32, minimum: u32, maximum: Option<u32>) -> u32 {
    // A monitor smaller than the configured minimum cannot be satisfied, so
    // keep the application's minimum as the hard floor and let the compositor
    // handle the exceptional case.
    let maximum = maximum
        .unwrap_or(MAX_DIMENSION)
        .clamp(minimum, MAX_DIMENSION);
    value.clamp(minimum, maximum)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum RestoreCall {
        SetSize(Dimensions),
        Center,
        Show,
    }

    struct FakeRestoreWindow {
        limit: Option<Dimensions>,
        resize_ok: bool,
        calls: RefCell<Vec<RestoreCall>>,
    }

    impl FakeRestoreWindow {
        fn new(limit: Option<Dimensions>, resize_ok: bool) -> Self {
            Self {
                limit,
                resize_ok,
                calls: RefCell::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<RestoreCall> {
            self.calls.borrow().clone()
        }
    }

    impl RestoreWindow for FakeRestoreWindow {
        fn work_area_limit(&self) -> Option<Dimensions> {
            self.limit
        }

        fn set_size(&self, size: Dimensions) -> bool {
            self.calls.borrow_mut().push(RestoreCall::SetSize(size));
            self.resize_ok
        }

        fn center(&self) {
            self.calls.borrow_mut().push(RestoreCall::Center);
        }

        fn show(&self) {
            self.calls.borrow_mut().push(RestoreCall::Show);
        }
    }

    #[test]
    fn restore_applies_the_clamped_size_centers_and_then_shows() {
        let window = FakeRestoreWindow::new(
            Some(Dimensions {
                width: 1280,
                height: 720,
            }),
            true,
        );
        restore_window(
            &window,
            Some(Dimensions {
                width: 2000,
                height: 1200,
            }),
        );
        assert_eq!(
            window.calls(),
            vec![
                RestoreCall::SetSize(Dimensions {
                    width: 1280,
                    height: 720,
                }),
                RestoreCall::Center,
                RestoreCall::Show,
            ]
        );
    }

    #[test]
    fn restore_still_shows_when_there_is_no_saved_size() {
        let window = FakeRestoreWindow::new(None, true);
        restore_window(&window, None);
        assert_eq!(window.calls(), vec![RestoreCall::Show]);
    }

    #[test]
    fn restore_still_shows_when_applying_the_saved_size_fails() {
        let window = FakeRestoreWindow::new(None, false);
        restore_window(
            &window,
            Some(Dimensions {
                width: 1200,
                height: 800,
            }),
        );
        assert_eq!(
            window.calls(),
            vec![
                RestoreCall::SetSize(Dimensions {
                    width: 1200,
                    height: 800,
                }),
                RestoreCall::Show,
            ]
        );
    }

    #[test]
    fn desktop_configs_create_the_main_window_hidden_for_restore() {
        for raw in [
            include_str!("../tauri.conf.json"),
            include_str!("../tauri.ai.conf.json"),
        ] {
            let config: serde_json::Value = serde_json::from_str(raw).unwrap();
            assert_eq!(config["app"]["windows"][0]["visible"], false);
        }
    }

    #[test]
    fn core_overlays_do_not_override_the_hidden_main_window() {
        // Windows Core and Linux Core add build/bundle settings only; the base
        // tauri.conf.json keeps the window hidden until restore() shows it.
        for raw in [
            include_str!("../tauri.core.conf.json"),
            include_str!("../tauri.linux-core.conf.json"),
        ] {
            let config: serde_json::Value = serde_json::from_str(raw).unwrap();
            assert!(config
                .get("app")
                .and_then(|app| app.get("windows"))
                .is_none());
        }
    }

    #[test]
    fn startup_background_matches_the_system_theme() {
        assert_eq!(startup_background(true), Color(30, 30, 30, 255));
        assert_eq!(startup_background(false), Color(255, 255, 255, 255));
    }

    #[test]
    fn android_config_keeps_its_main_window_visible() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.android.conf.json")).unwrap();
        assert_eq!(config["app"]["windows"][0]["visible"], true);
    }

    #[test]
    fn stored_size_has_only_the_version_and_dimensions() {
        let stored = StoredWindowSize {
            schema_version: SCHEMA_VERSION,
            width: 1200,
            height: 800,
        };
        let value = serde_json::to_value(stored).unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "schemaVersion": 1, "width": 1200, "height": 800 })
        );
    }

    #[test]
    fn invalid_or_unknown_saved_data_falls_back_to_none() {
        assert_eq!(
            decode_saved_size(r#"{"schemaVersion":1,"width":1200,"height":800}"#),
            Some(Dimensions {
                width: 1200,
                height: 800
            })
        );
        assert_eq!(
            decode_saved_size(r#"{"schemaVersion":2,"width":1200,"height":800}"#),
            None
        );
        assert_eq!(
            decode_saved_size(r#"{"schemaVersion":1,"width":0,"height":800}"#),
            None
        );
        assert_eq!(decode_saved_size("not json"), None);
    }

    #[test]
    fn dimensions_are_clamped_to_the_minimum_and_current_work_area() {
        assert_eq!(
            clamp_dimensions(
                Dimensions {
                    width: 2000,
                    height: 1200
                },
                Some(Dimensions {
                    width: 1280,
                    height: 720
                })
            ),
            Dimensions {
                width: 1280,
                height: 720
            }
        );
        assert_eq!(
            clamp_dimensions(
                Dimensions {
                    width: 200,
                    height: 200
                },
                None
            ),
            Dimensions {
                width: MIN_WIDTH,
                height: MIN_HEIGHT
            }
        );
        assert_eq!(
            clamp_dimensions(
                Dimensions {
                    width: 20_000,
                    height: 20_000
                },
                None
            ),
            Dimensions {
                width: MAX_DIMENSION,
                height: MAX_DIMENSION
            }
        );
    }

    #[test]
    fn work_area_uses_logical_pixels_and_rejects_bad_scale_factors() {
        assert_eq!(
            logical_work_area_limit(PhysicalSize::new(1920, 1040), 1.5),
            Some(Dimensions {
                width: 1280,
                height: 693
            })
        );
        assert_eq!(
            logical_work_area_limit(PhysicalSize::new(1920, 1040), 0.0),
            None
        );
    }

    #[test]
    fn physical_sizes_are_converted_back_to_logical_pixels() {
        assert_eq!(
            logical_size_from_physical(PhysicalSize::new(1500, 1000), 1.25),
            Some(Dimensions {
                width: 1200,
                height: 800
            })
        );
        assert_eq!(
            logical_size_from_physical(PhysicalSize::new(100, 100), 1.0),
            Some(Dimensions {
                width: MIN_WIDTH,
                height: MIN_HEIGHT
            })
        );
    }
}
