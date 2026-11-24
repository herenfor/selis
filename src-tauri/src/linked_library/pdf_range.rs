//! Window-owned random access to a verified original PDF.
use super::*;
use std::sync::atomic::AtomicBool;

type Error = LinkedLibraryError;
trait PdfInput: Read + Seek + Send {}
impl<T: Read + Seek + Send> PdfInput for T {}

struct Session {
    owner: String,
    length: u64,
    closed: AtomicBool,
    input: Mutex<(Box<dyn PdfInput>, Box<dyn Fn() -> Result<(), Error> + Send>)>,
}
#[derive(Default)]
pub(crate) struct PdfRanges(Mutex<HashMap<String, Arc<Session>>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Opened {
    session_id: String,
    length: u64,
}
const MAX_BYTES: u64 = 512 * 1024 * 1024;
const CHUNK: u64 = 256 * 1024;

fn open_source(app: &AppHandle, owner: String, hash: &str) -> Result<Session, Error> {
    let _lease = library_location::source_lease(app)?;
    if !valid_content_hash(hash) {
        return Err("无效书籍指纹".into());
    }
    #[cfg(target_os = "android")]
    if let Some((binding, record)) = find_document_binding(app, hash)? {
        if !crate::document_formats::pdf(&record.file_name) {
            return Err("不是 PDF 书籍".into());
        }
        check_length(binding.file_size)?;
        let (reader, guard) =
            document_source::verified_document(app, binding.document_uri().unwrap(), hash)?;
        if !find_document_binding(app, hash)?.is_some_and(|(current, _)| current == binding) {
            return Err(Error::changed("原书绑定已变化"));
        }
        return Ok(Session {
            owner,
            length: reader.len(),
            closed: false.into(),
            input: Mutex::new((
                Box::new(reader),
                Box::new(move || guard().map_err(archive::archive_fault_error)),
            )),
        });
    }
    let (root, pending) = prepare_library_source_read(app, hash)?;
    if !crate::document_formats::pdf(&pending.file_name) {
        return Err("不是 PDF 书籍".into());
    }
    let file = pending.file;
    let length = file.metadata().map_err(source_open_error)?.len();
    check_length(length)?;
    let (digest, verified) = hash_opened_file(&file)?;
    if digest != hash {
        return Err(Error::changed("原书内容已变化，请重新导入"));
    }
    finalize_library_source_read(
        app,
        &root,
        &pending.identity,
        &pending.old_snapshot,
        &verified,
    )?;
    let stat = file.try_clone().map_err(source_open_error)?;
    let guard = move || {
        if snapshot_file(&stat)? != verified {
            return Err(Error::changed("阅读中的 PDF 已变化，请重新打开"));
        }
        Ok(())
    };
    Ok(Session {
        owner,
        length,
        closed: false.into(),
        input: Mutex::new((Box::new(file), Box::new(guard))),
    })
}
fn check_length(len: u64) -> Result<(), Error> {
    if len == 0 || len > MAX_BYTES {
        return Err("PDF 为空或超过本阅读器 512 MiB 的单书上限".into());
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn pdf_range_open(
    app: AppHandle,
    window: tauri::Window,
    content_hash: String,
) -> Result<Opened, Error> {
    let owner = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let session = open_source(&app, owner.clone(), &content_hash)?;
        let length = session.length;
        check_length(length)?;
        let id = random_uuid_v4()?;
        let state = app.state::<PdfRanges>();
        let mut sessions = state.0.lock().map_err(|_| "PDF 会话不可用")?;
        if app.get_webview_window(&owner).is_none() {
            return Err("阅读窗口已关闭".into());
        }
        sessions.insert(id.clone(), Arc::new(session));
        Ok(Opened {
            session_id: id,
            length,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn pdf_range_read(
    app: AppHandle,
    window: tauri::Window,
    session_id: String,
    begin: u64,
    end: u64,
) -> Result<tauri::ipc::Response, Error> {
    let state = app.state::<PdfRanges>();
    let session = state
        .0
        .lock()
        .map_err(|_| "PDF 会话不可用")?
        .get(&session_id)
        .filter(|s| s.owner == window.label())
        .cloned()
        .ok_or("PDF 已关闭")?;
    tauri::async_runtime::spawn_blocking(move || {
        if end <= begin || end > session.length || end - begin > CHUNK {
            return Err("无效的 PDF 字节范围".into());
        }
        let mut input = session.input.lock().map_err(|_| "读取 PDF 失败")?;
        if session.closed.load(Ordering::Acquire) {
            return Err("PDF 已关闭".into());
        }
        input.1()?;
        input
            .0
            .seek(SeekFrom::Start(begin))
            .map_err(source_open_error)?;
        let mut bytes = vec![0; (end - begin) as usize];
        input.0.read_exact(&mut bytes).map_err(source_open_error)?;
        input.1()?;
        if session.closed.load(Ordering::Acquire) {
            return Err("PDF 已关闭".into());
        }
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) fn pdf_range_close(app: AppHandle, window: tauri::Window, session_id: String) {
    close_matching(&app, |id, owner| {
        id == session_id && owner == window.label()
    });
}
pub(crate) fn close_window(app: &AppHandle, owner: Option<&str>) {
    close_matching(app, |_, label| owner.is_none_or(|value| label == value));
}
fn close_matching(app: &AppHandle, matches: impl Fn(&str, &str) -> bool) {
    let state = app.state::<PdfRanges>();
    let mut sessions = state.0.lock().unwrap_or_else(|e| e.into_inner());
    sessions.retain(|id, s| {
        if !matches(id, &s.owner) {
            return true;
        }
        s.closed.store(true, Ordering::Release);
        false
    });
}
