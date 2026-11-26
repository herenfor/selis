use crate::portable_state::{PortableError, PortableResult};
use crate::portable_state_commands::{with_store, PortableStateManager};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager};

const KEY_LETTER_META: &str = "readingLetter:meta";
const KEY_LETTER_STATE: &str = "readingLetter:state";
const KEY_LETTER_PREVIEW: &str = "readingLetter:preview";
const MAX_DELTA_SECONDS: i64 = 180;
const MIN_DELTA_SECONDS: i64 = 5;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DayReadingRecord {
    pub books: BTreeMap<String, i64>,
    pub hours: BTreeMap<String, i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_minute: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_minute: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookReadingSnapshot {
    pub title: String,
    pub creator: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_month: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LongestSessionRecord {
    pub day: i64,
    pub book_key: String,
    pub seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingLogData {
    pub version: u8,
    pub days: BTreeMap<String, DayReadingRecord>,
    pub book_meta: BTreeMap<String, BookReadingSnapshot>,
    pub longest_by_month: BTreeMap<String, LongestSessionRecord>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LetterMetaBlob {
    #[serde(default)]
    book_meta: BTreeMap<String, BookReadingSnapshot>,
    #[serde(default)]
    longest_by_month: BTreeMap<String, LongestSessionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnnualChoice {
    pub book_key: String,
    pub epigraph: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingLetterState {
    pub version: u8,
    #[serde(default)]
    pub opened_on_day_by_period: BTreeMap<String, String>,
    #[serde(default)]
    pub annual_choices: BTreeMap<String, AnnualChoice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_tone: Option<String>,
}

impl Default for ReadingLetterState {
    fn default() -> Self {
        Self {
            version: 1,
            opened_on_day_by_period: BTreeMap::new(),
            annual_choices: BTreeMap::new(),
            paper_tone: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingLetterSnapshot {
    pub log: ReadingLogData,
    pub state: ReadingLetterState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordDeltaInput {
    pub date_key: String,
    pub month_key: String,
    pub hour_key: String,
    pub minute_of_day: i64,
    pub day_of_month: i64,
    pub book_key: String,
    pub title: String,
    pub creator: String,
    pub seconds: i64,
    pub session_seconds: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkFinishedInput {
    pub book_key: String,
    pub title: String,
    pub creator: String,
    pub month_key: String,
}

fn load_meta_opt<T: serde::de::DeserializeOwned>(
    conn: &Connection,
    key: &str,
) -> PortableResult<Option<T>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT json FROM local_meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?;
    match raw {
        Some(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|e| PortableError::invalid_data(format!("无法读取 {key}：{e}"))),
        None => Ok(None),
    }
}

fn save_meta<T: Serialize>(conn: &Connection, key: &str, value: &T) -> PortableResult<()> {
    let raw = serde_json::to_string(value)
        .map_err(|e| PortableError::storage_error(format!("无法序列化 {key}：{e}")))?;
    conn.execute(
        "INSERT INTO local_meta(key, json) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET json = excluded.json",
        params![key, raw],
    )?;
    Ok(())
}

pub fn load_snapshot(conn: &Connection) -> PortableResult<ReadingLetterSnapshot> {
    let mut days: BTreeMap<String, DayReadingRecord> = BTreeMap::new();
    let mut stmt = conn.prepare(
        "SELECT date_key, book_hash, seconds, hours_json, first_minute, last_minute
         FROM reading_activity",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<i64>>(4)?,
            row.get::<_, Option<i64>>(5)?,
        ))
    })?;

    for row in rows {
        let (dk, bh, sec, hours_raw, first_min, last_min) = row?;
        let hours: BTreeMap<String, i64> = serde_json::from_str(&hours_raw).unwrap_or_default();
        let entry = days.entry(dk).or_default();
        if sec > 0 {
            *entry.books.entry(bh).or_insert(0) += sec;
        }
        for (hr, h_sec) in hours {
            if h_sec > 0 {
                *entry.hours.entry(hr).or_insert(0) += h_sec;
            }
        }
        if let Some(fm) = first_min {
            entry.first_minute = Some(entry.first_minute.map_or(fm, |v| v.min(fm)));
        }
        if let Some(lm) = last_min {
            entry.last_minute = Some(entry.last_minute.map_or(lm, |v| v.max(lm)));
        }
    }

    let meta = load_meta_opt::<LetterMetaBlob>(conn, KEY_LETTER_META)?.unwrap_or_default();
    let state = load_meta_opt::<ReadingLetterState>(conn, KEY_LETTER_STATE)?.unwrap_or_default();
    let preview_mode = load_meta_opt::<String>(conn, KEY_LETTER_PREVIEW)?
        .filter(|s| matches!(s.as_str(), "monthly" | "annual" | "empty"));

    Ok(ReadingLetterSnapshot {
        log: ReadingLogData {
            version: 1,
            days,
            book_meta: meta.book_meta,
            longest_by_month: meta.longest_by_month,
        },
        state,
        preview_mode,
    })
}

pub fn record_delta(conn: &mut Connection, input: &RecordDeltaInput) -> PortableResult<()> {
    let sec = input.seconds.min(MAX_DELTA_SECONDS);
    if input.book_key.trim().is_empty() || sec < MIN_DELTA_SECONDS {
        return Ok(());
    }
    let tx = conn.transaction()?;

    let existing: Option<(i64, String, Option<i64>, Option<i64>)> = tx
        .query_row(
            "SELECT seconds, hours_json, first_minute, last_minute
             FROM reading_activity WHERE date_key = ?1 AND book_hash = ?2",
            params![input.date_key, input.book_key],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;

    let (prev_sec, mut hours, prev_first, prev_last) = match existing {
        Some((s, h_raw, fm, lm)) => (
            s,
            serde_json::from_str::<BTreeMap<String, i64>>(&h_raw).unwrap_or_default(),
            fm,
            lm,
        ),
        None => (0, BTreeMap::new(), None, None),
    };

    *hours.entry(input.hour_key.clone()).or_insert(0) += sec;
    let hours_json = serde_json::to_string(&hours)
        .map_err(|e| PortableError::storage_error(format!("无法序列化小时分布：{e}")))?;
    let next_first = Some(prev_first.map_or(input.minute_of_day, |v| v.min(input.minute_of_day)));
    let next_last = Some(prev_last.map_or(input.minute_of_day, |v| v.max(input.minute_of_day)));

    tx.execute(
        "INSERT INTO reading_activity(date_key, book_hash, seconds, hours_json, first_minute, last_minute)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(date_key, book_hash) DO UPDATE SET
           seconds = excluded.seconds,
           hours_json = excluded.hours_json,
           first_minute = excluded.first_minute,
           last_minute = excluded.last_minute",
        params![
            input.date_key,
            input.book_key,
            prev_sec + sec,
            hours_json,
            next_first,
            next_last,
        ],
    )?;

    let mut meta = load_meta_opt::<LetterMetaBlob>(&tx, KEY_LETTER_META)?.unwrap_or_default();
    let snap = meta.book_meta.entry(input.book_key.clone()).or_default();
    if !input.title.is_empty() {
        snap.title = input.title.clone();
    }
    if !input.creator.is_empty() {
        snap.creator = input.creator.clone();
    }
    let cand_session = input.session_seconds.max(sec);
    let replace_longest = meta
        .longest_by_month
        .get(&input.month_key)
        .is_none_or(|prev| cand_session > prev.seconds);
    if replace_longest {
        meta.longest_by_month.insert(
            input.month_key.clone(),
            LongestSessionRecord {
                day: input.day_of_month,
                book_key: input.book_key.clone(),
                seconds: cand_session,
            },
        );
    }
    save_meta(&tx, KEY_LETTER_META, &meta)?;
    tx.commit()?;
    Ok(())
}

pub fn mark_finished(conn: &mut Connection, input: &MarkFinishedInput) -> PortableResult<()> {
    if input.book_key.trim().is_empty() {
        return Ok(());
    }
    let tx = conn.transaction()?;
    let mut meta = load_meta_opt::<LetterMetaBlob>(&tx, KEY_LETTER_META)?.unwrap_or_default();
    let snap = meta.book_meta.entry(input.book_key.clone()).or_default();
    if snap.finished_month.is_none() {
        if !input.title.is_empty() {
            snap.title = input.title.clone();
        }
        if !input.creator.is_empty() {
            snap.creator = input.creator.clone();
        }
        snap.finished_month = Some(input.month_key.clone());
        save_meta(&tx, KEY_LETTER_META, &meta)?;
    }
    tx.commit()?;
    Ok(())
}

pub fn save_state(conn: &Connection, state: &ReadingLetterState) -> PortableResult<()> {
    save_meta(conn, KEY_LETTER_STATE, state)
}

#[tauri::command]
pub async fn reading_letter_load(app: AppHandle) -> PortableResult<ReadingLetterSnapshot> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.state::<PortableStateManager>();
        with_store(&app, &manager, |store| store.with_connection_mut(|c| load_snapshot(c)))
    })
    .await
    .map_err(|e| PortableError::storage_error(format!("读取阅读来信任务失败：{e}")))?
}

#[tauri::command]
pub async fn reading_letter_record_delta(
    app: AppHandle,
    input: RecordDeltaInput,
) -> PortableResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.state::<PortableStateManager>();
        with_store(&app, &manager, |store| store.with_connection_mut(|c| record_delta(c, &input)))
    })
    .await
    .map_err(|e| PortableError::storage_error(format!("记录阅读时长任务失败：{e}")))?
}

#[tauri::command]
pub async fn reading_letter_mark_finished(
    app: AppHandle,
    input: MarkFinishedInput,
) -> PortableResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.state::<PortableStateManager>();
        with_store(&app, &manager, |store| store.with_connection_mut(|c| mark_finished(c, &input)))
    })
    .await
    .map_err(|e| PortableError::storage_error(format!("标记读完任务失败：{e}")))?
}

#[tauri::command]
pub async fn reading_letter_save_state(
    app: AppHandle,
    state: ReadingLetterState,
) -> PortableResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.state::<PortableStateManager>();
        with_store(&app, &manager, |store| store.with_connection_mut(|c| save_state(c, &state)))
    })
    .await
    .map_err(|e| PortableError::storage_error(format!("保存来信状态任务失败：{e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::portable_state::PortableStore;

    #[test]
    fn reading_activity_and_letter_state_round_trip() {
        let mut store = PortableStore::open_in_memory().unwrap();
        store
            .with_connection_mut(|conn| {
                // Ignores sub-threshold delta; clamps > 180s delta.
                record_delta(
                    conn,
                    &RecordDeltaInput {
                        date_key: "2026-10-12".into(),
                        month_key: "2026-10".into(),
                        hour_key: "21".into(),
                        minute_of_day: 21 * 60 + 35,
                        day_of_month: 12,
                        book_key: "hash-a".into(),
                        title: "白鲸".into(),
                        creator: "梅尔维尔".into(),
                        seconds: 3,
                        session_seconds: 3,
                    },
                )?;
                record_delta(
                    conn,
                    &RecordDeltaInput {
                        date_key: "2026-10-12".into(),
                        month_key: "2026-10".into(),
                        hour_key: "21".into(),
                        minute_of_day: 21 * 60 + 40,
                        day_of_month: 12,
                        book_key: "hash-a".into(),
                        title: "白鲸".into(),
                        creator: "梅尔维尔".into(),
                        seconds: 500,
                        session_seconds: 1200,
                    },
                )?;
                mark_finished(
                    conn,
                    &MarkFinishedInput {
                        book_key: "hash-a".into(),
                        title: "白鲸".into(),
                        creator: "梅尔维尔".into(),
                        month_key: "2026-10".into(),
                    },
                )?;
                let mut state = ReadingLetterState::default();
                state.opened_on_day_by_period.insert("2026-10".into(), "2026-11-01".into());
                state.paper_tone = Some("sepia".into());
                save_state(conn, &state)?;
                save_meta(conn, KEY_LETTER_PREVIEW, &"monthly".to_string())?;

                let snap = load_snapshot(conn)?;
                assert_eq!(snap.log.days["2026-10-12"].books["hash-a"], MAX_DELTA_SECONDS);
                assert_eq!(snap.log.days["2026-10-12"].hours["21"], MAX_DELTA_SECONDS);
                assert_eq!(snap.log.longest_by_month["2026-10"].seconds, 1200);
                assert_eq!(snap.log.book_meta["hash-a"].finished_month.as_deref(), Some("2026-10"));
                assert_eq!(snap.state.paper_tone.as_deref(), Some("sepia"));
                assert_eq!(snap.preview_mode.as_deref(), Some("monthly"));
                Ok(())
            })
            .unwrap();
    }
}
