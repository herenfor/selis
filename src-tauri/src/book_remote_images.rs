//! Only the trusted reading frontend asks for bytes from this service.
use reqwest::{redirect::Policy, Url};
use std::{collections::HashMap, net::IpAddr, sync::Mutex, time::Duration};

const MAX_BYTES: usize = 4 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(5);
static DOWNLOADS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

fn public_ip(addr: IpAddr) -> bool {
    match addr {
        IpAddr::V4(addr) => {
            let [a, b, c, _] = addr.octets();
            !matches!(a, 0 | 10 | 127 | 224..=255)
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 169 && b == 254)
                && !(a == 172 && (16..=31).contains(&b))
                && !(a == 192 && (b == 0 || b == 168 || b == 88 && c == 99))
                && !(a == 198 && (b == 18 || b == 19))
                && !addr.is_documentation()
        }
        IpAddr::V6(addr) => {
            let [a, b, ..] = addr.segments();
            (0x2000..=0x3fff).contains(&a)
                && a != 0x2002
                && a != 0x3fff
                && !(a == 0x2001 && (b < 0x0200 || b == 0x0db8))
        }
    }
}

fn image_url(source: &str) -> Option<Url> {
    if source.len() > 4096 {
        return None;
    }
    let mut url = Url::parse(source).ok()?;
    let hostname = url.domain()?;
    if url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || !hostname.contains('.')
        || hostname.ends_with('.')
        || [".localhost", ".local", ".internal", ".lan", ".home.arpa"]
            .iter()
            .any(|suffix| hostname.ends_with(suffix))
    {
        return None;
    }
    url.set_fragment(None);
    Some(url)
}

fn raster_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

async fn download(source: &str) -> Result<Vec<u8>, &'static str> {
    let url = image_url(source).ok_or("不支持的书籍图片地址")?;
    let domain = url.domain().ok_or("缺少图片域名")?;
    let addresses: Vec<_> = tokio::net::lookup_host((domain, 443))
        .await
        .map_err(|_| "解析书籍图片域名失败")?
        .take(33)
        .collect();
    if addresses.is_empty()
        || addresses.len() > 32
        || addresses.iter().any(|addr| !public_ip(addr.ip()))
    {
        return Err("书籍图片地址不可用");
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .https_only(true)
        .redirect(Policy::none())
        .resolve_to_addrs(domain, &addresses)
        .timeout(TIMEOUT)
        .build()
        .map_err(|_| "无法创建书籍图片请求")?;
    let mut response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "image/png,image/jpeg,image/webp")
        .send()
        .await
        .map_err(|_| "获取书籍图片失败")?;
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !response.status().is_success()
        || !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/webp")
        || response
            .content_length()
            .is_some_and(|n| n > MAX_BYTES as u64)
    {
        return Err("书籍图片响应不受支持");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取书籍图片失败")? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("书籍图片体积过大");
        }
        bytes.extend_from_slice(&chunk);
    }
    let size = imagesize::blob_size(&bytes).map_err(|_| "书籍图片格式无效")?;
    if raster_mime(&bytes) != Some(mime.as_str())
        || size.width == 0
        || size.height == 0
        || size.width > 8192
        || size.height > 8192
        || size.width * size.height > 16_000_000
    {
        return Err("书籍图片格式或尺寸不受支持");
    }
    Ok(bytes)
}

#[derive(Default)]
pub(crate) struct RemoteImageRequests(Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>);

#[tauri::command]
pub(crate) async fn book_remote_image(
    window: tauri::WebviewWindow,
    requests: tauri::State<'_, RemoteImageRequests>,
    url: String,
    request_id: String,
) -> Result<tauri::ipc::Response, &'static str> {
    if window.label() != "main" || !cfg!(any(target_os = "windows", target_os = "android")) {
        return Err("书籍图片只在原生主阅读窗口可用");
    }
    if request_id.len() != 36
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'-')
    {
        return Err("书籍图片请求编号无效");
    }
    let _permit = DOWNLOADS.try_acquire().map_err(|_| "书籍图片请求过多")?;
    let (cancel, cancelled) = tokio::sync::oneshot::channel();
    {
        let mut pending = requests.0.lock().map_err(|_| "书籍图片服务不可用")?;
        if pending.contains_key(&request_id) {
            return Err("重复的书籍图片请求");
        }
        pending.insert(request_id.clone(), cancel);
    }
    let result = tokio::select! {
        result = tokio::time::timeout(TIMEOUT, download(&url)) => result.unwrap_or(Err("书籍图片请求超时")),
        _ = cancelled => Err("书籍图片请求已取消"),
    };
    if let Ok(mut pending) = requests.0.lock() {
        pending.remove(&request_id);
    }
    result.map(tauri::ipc::Response::new)
}

#[tauri::command]
pub(crate) fn cancel_book_remote_image(
    window: tauri::WebviewWindow,
    requests: tauri::State<'_, RemoteImageRequests>,
    request_id: String,
) {
    if window.label() != "main" {
        return;
    }
    if let Ok(mut pending) = requests.0.lock() {
        if let Some(cancel) = pending.remove(&request_id) {
            let _ = cancel.send(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_images_require_public_https() {
        for denied in [
            "http://example.org/a.png",
            "https://u:p@example.org/",
            "https://example.org:8443/",
            "https://127.0.0.1/",
            "https://device.local/",
            "https://[::1]/",
        ] {
            assert!(image_url(denied).is_none());
        }
        for denied in [
            "127.0.0.1",
            "100.64.0.1",
            "192.168.1.1",
            "169.254.1.2",
            "::ffff:8.8.8.8",
            "2002::1",
            "fe80::1",
        ] {
            assert!(!public_ip(denied.parse().unwrap()));
        }
        assert!(public_ip("8.8.8.8".parse().unwrap()));
        assert!(image_url("https://example.org/a.png").is_some());
    }
}
