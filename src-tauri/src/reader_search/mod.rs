//! Per-open-archive reader search. The cache owns text only and dies with the archive.
mod text;
use crate::native_zip_session::{Fault, NativeZipSession, CHUNK_BYTES};
use memchr::memmem::Finder;
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
};
use text::Chapter;

#[derive(Default)]
pub(crate) struct SearchCache {
    entries: HashMap<usize, Option<Arc<Chapter>>>,
    order: VecDeque<usize>,
    bytes: usize,
}
fn charge(chapter: &Option<Arc<Chapter>>) -> usize {
    128 + chapter
        .as_ref()
        .map_or(0, |c| c.text.capacity() + c.normalized.capacity())
}
impl SearchCache {
    fn put(&mut self, index: usize, chapter: Option<Arc<Chapter>>) {
        if self.entries.contains_key(&index) {
            return;
        }
        self.bytes += charge(&chapter);
        self.entries.insert(index, chapter);
        self.order.push_back(index);
        while self.bytes > 32 * 1024 * 1024 {
            if let Some(old) = self.order.pop_front() {
                if let Some(entry) = self.entries.remove(&old) {
                    self.bytes -= charge(&entry);
                }
            } else {
                break;
            }
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Scan {
    Miss,
    Compatibility,
    Match {
        text: String,
        starts: Option<Vec<u32>>,
    },
}

fn scan(chapter: &Chapter, phrase: &Finder, tokens: &[Finder]) -> Scan {
    let hay = chapter.normalized.as_bytes();
    if tokens.len() > 1 {
        if phrase.find(hay).is_some()
            || hay
                .split(|&b| b == 0)
                .any(|block| tokens.iter().all(|t| t.find(block).is_some()))
        {
            return Scan::Match {
                text: chapter.text.clone(),
                starts: None,
            };
        }
    } else {
        let mut starts = Vec::new();
        let mut byte = 0;
        let mut unit = 0;
        for at in phrase.find_iter(hay) {
            // Dense chapters are cheaper to send once than a large array of offsets.
            if starts.len() == 4096 {
                return Scan::Match {
                    text: chapter.text.clone(),
                    starts: None,
                };
            }
            unit += chapter.normalized[byte..at].encode_utf16().count() as u32;
            byte = at;
            starts.push(unit);
        }
        if !starts.is_empty() {
            return Scan::Match {
                text: chapter.text.clone(),
                starts: Some(starts),
            };
        }
    }
    Scan::Miss
}

pub(crate) fn batch(
    session: &NativeZipSession,
    indices: &[usize],
    query: &str,
    tokens: &[String],
) -> Result<Vec<Scan>, Fault> {
    if indices.len() > 32
        || query.len() > 16384
        || tokens.len() > 128
        || tokens.iter().map(String::len).sum::<usize>() > 16384
    {
        return Err(Fault::InvalidRequest);
    }
    let phrase = Finder::new(query);
    let tokens: Vec<_> = tokens.iter().map(Finder::new).collect();
    let cache: &Mutex<SearchCache> = &session.reader_search;
    indices
        .iter()
        .map(|&index| {
            if index >= session.entry_count || session.is_closed() {
                return Err(Fault::InvalidRequest);
            }
            let cached = cache
                .lock()
                .map_err(|_| Fault::Closed)?
                .entries
                .get(&index)
                .cloned();
            let chapter = match cached {
                Some(c) => c,
                None => {
                    let bytes = session.read_chunk(index, 0)?;
                    let c = if bytes.len() < CHUNK_BYTES {
                        Chapter::parse(&bytes).map(Arc::new)
                    } else {
                        None
                    };
                    cache
                        .lock()
                        .map_err(|_| Fault::Closed)?
                        .put(index, c.clone());
                    c
                }
            };
            Ok(chapter.as_ref().map_or(Scan::Compatibility, |c| {
                if query.is_empty() {
                    Scan::Miss
                } else {
                    scan(c, &phrase, &tokens)
                }
            }))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_utf16_positions_across_ruby_and_normalization() {
        let xml = r#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><p>😀<ruby>律<rt>りつ</rt></ruby>你Ａﬃ</p><aside epub:type="footnote">注</aside><p>末</p></body></html>"#;
        let chapter = Chapter::parse(xml.as_bytes()).unwrap();
        assert_eq!(chapter.text, "😀律你Ａﬃ\0末");
        assert_eq!(chapter.normalized, "😀律你affi\0末");
        match scan(&chapter, &Finder::new("律你a"), &[]) {
            Scan::Match { starts, .. } => assert_eq!(starts.unwrap(), vec![2]),
            _ => panic!("expected a body-text match after the surrogate pair"),
        }
        assert!(matches!(
            scan(&chapter, &Finder::new("i末"), &[]),
            Scan::Miss
        ));
        assert!(Chapter::parse(b"<html><p>unclosed").is_none());
    }
}
