use serde::Deserialize;

use crate::error::{AppError, AppResult};

#[derive(Deserialize, Debug)]
pub struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// 윈도우의 hit-test 영역을 logical 사각형들의 union으로 설정한다.
/// region 밖은 OS가 윈도우의 일부로 인식하지 않아 마우스 이벤트가 통과한다.
#[tauri::command]
pub async fn window_set_hit_region(
    window: tauri::WebviewWindow,
    rects: Vec<LogicalRect>,
) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows_sys::Win32::Graphics::Gdi::{
            CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_OR,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            SWP_NOZORDER,
        };

        let scale = window
            .scale_factor()
            .map_err(|e| AppError::Internal(format!("scale_factor: {e}")))?;

        let hwnd = window
            .hwnd()
            .map_err(|e| AppError::Internal(format!("hwnd: {e}")))?;
        let raw_hwnd = hwnd.0 as _;

        let apply = |region: HRGN| {
            // bRedraw=TRUE(1)로 즉시 재합성, SWP_FRAMECHANGED로 비-클라이언트 영역 캐시 무효화.
            SetWindowRgn(raw_hwnd, region, 1);
            SetWindowPos(
                raw_hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
        };

        if rects.is_empty() {
            // 빈 region = 전체 통과 X. 더미 1x1 region.
            let rgn = CreateRectRgn(0, 0, 1, 1);
            apply(rgn);
            return Ok(());
        }

        let mut combined: HRGN = std::ptr::null_mut();
        for r in rects.iter() {
            let x1 = (r.x * scale).round() as i32;
            let y1 = (r.y * scale).round() as i32;
            let x2 = ((r.x + r.w) * scale).round() as i32;
            let y2 = ((r.y + r.h) * scale).round() as i32;
            let rgn = CreateRectRgn(x1, y1, x2, y2);
            if combined.is_null() {
                combined = rgn;
            } else {
                let merged = CreateRectRgn(0, 0, 0, 0);
                CombineRgn(merged, combined, rgn, RGN_OR);
                DeleteObject(combined as _);
                DeleteObject(rgn as _);
                combined = merged;
            }
        }

        // SetWindowRgn takes ownership of the region handle, do NOT DeleteObject after.
        apply(combined);
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, rects);
        Ok(())
    }
}
