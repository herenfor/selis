//! A query keeps compact UTF-16 ranges. Only the requested slice crosses the bridge.
use super::text::Chapter;
use memchr::memmem::Finder;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::mem::size_of;
use std::sync::Arc;

type Span = [u32; 2];

#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub(crate) enum Request {
    Count,
    Window {
        offset: usize,
        limit: usize,
        #[serde(default, rename = "includeTarget")]
        include_target: bool,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Row {
    pub ranges: Vec<Span>,
    pub keywords: bool,
}

#[derive(Serialize)]
pub(crate) struct WindowRow {
    #[serde(flatten)]
    hit: Row,
    // JS snippets can end in half a surrogate pair. Preserve the exact UTF-16 slice.
    context: Vec<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<super::target::Target>,
}

pub(super) fn excerpts(text: &str, rows: Vec<Row>, include_target: bool) -> Vec<WindowRow> {
    let units: Vec<_> = text.encode_utf16().collect();
    rows.into_iter()
        .map(|hit| {
            let start = hit.ranges.iter().map(|r| r[0]).min().unwrap() as usize;
            let end = hit.ranges.iter().map(|r| r[1]).max().unwrap() as usize;
            let context = units[start.saturating_sub(48)..(end + 96).min(units.len())].to_vec();
            let target = include_target.then(|| super::target::resolve(&units, &hit.ranges));
            WindowRow {
                hit,
                context,
                target,
            }
        })
        .collect()
}

// Common single-term queries pay exactly two u32s per hit, including dense CJK text.
pub(super) enum Matches {
    Phrase(Vec<Span>),
    Mixed(Vec<Row>),
}

impl Matches {
    pub fn build(chapter: &Chapter, phrase: &Finder, tokens: &[Finder]) -> Self {
        let hay = chapter.normalized.as_bytes();
        let phrases = phrase.find_iter(hay);
        let mut blocks = Vec::new();
        if tokens.len() > 1 {
            let mut base = 0;
            for block in hay.split(|b| *b == 0) {
                let spans: Option<Vec<_>> = tokens
                    .iter()
                    .map(|t| {
                        let start = base + t.find(block)?;
                        Some((start, start + t.needle().len()))
                    })
                    .collect();
                if let Some(spans) = spans {
                    blocks.push(spans);
                }
                base += block.len() + 1;
            }
        }
        let mut phrases = phrases.peekable();
        if phrases.peek().is_none() && blocks.is_empty() {
            return Self::Phrase(Vec::new());
        }
        let map = chapter.raw_byte_spans();
        let raw = |start: usize, end: usize| [map[start][0], map[end - 1][1]];
        let mut spans = Vec::new();
        for start in phrases {
            let span = raw(start, start + phrase.needle().len());
            if spans.last() != Some(&span) {
                spans.push(span);
            }
        }
        if blocks.is_empty() {
            return Self::Phrase(spans);
        }
        // Phrase wins when a keyword group encloses the same original occurrence.
        let mut seen: HashSet<_> = spans.iter().copied().collect();
        let mut rows: Vec<_> = spans
            .into_iter()
            .map(|s| {
                (
                    s[0],
                    Row {
                        keywords: false,
                        ranges: vec![s],
                    },
                )
            })
            .collect();
        for block in blocks {
            let ranges: Vec<_> = block.into_iter().map(|(a, b)| raw(a, b)).collect();
            let start = ranges.iter().map(|r| r[0]).min().unwrap();
            let end = ranges.iter().map(|r| r[1]).max().unwrap();
            if seen.insert([start, end]) {
                rows.push((
                    start,
                    Row {
                        keywords: true,
                        ranges,
                    },
                ));
            }
        }
        rows.sort_by_key(|(start, _)| *start);
        Self::Mixed(rows.into_iter().map(|(_, row)| row).collect())
    }

    pub fn len(&self) -> usize {
        match self {
            Self::Phrase(v) => v.len(),
            Self::Mixed(v) => v.len(),
        }
    }
    fn bytes(&self) -> usize {
        match self {
            Self::Phrase(v) => v.capacity() * size_of::<Span>(),
            Self::Mixed(v) => {
                v.capacity() * size_of::<Row>()
                    + v.iter()
                        .map(|row| row.ranges.capacity() * size_of::<Span>())
                        .sum::<usize>()
            }
        }
    }
    pub fn window(&self, offset: usize, limit: usize) -> Vec<Row> {
        let start = offset.min(self.len());
        let end = start.saturating_add(limit).min(self.len());
        match self {
            Self::Phrase(v) => v[start..end]
                .iter()
                .map(|s| Row {
                    ranges: vec![*s],
                    keywords: false,
                })
                .collect(),
            Self::Mixed(v) => v[start..end]
                .iter()
                .map(|r| Row {
                    ranges: r.ranges.clone(),
                    keywords: r.keywords,
                })
                .collect(),
        }
    }
}

// Entries evicted from this memo can be recomputed from the same verified archive.
#[derive(Default)]
pub(super) struct IndexCache {
    phrase: String,
    tokens: Vec<String>,
    chapters: HashMap<usize, Arc<Matches>>,
    fifo: VecDeque<(usize, usize)>,
    bytes: usize,
}
impl IndexCache {
    pub fn select(&mut self, phrase: &str, tokens: &[String]) {
        if self.phrase != phrase || self.tokens != tokens {
            *self = Self {
                phrase: phrase.to_owned(),
                tokens: tokens.to_vec(),
                ..Self::default()
            };
        }
    }
    pub fn get(&self, index: usize) -> Option<Arc<Matches>> {
        self.chapters.get(&index).cloned()
    }
    pub fn put(&mut self, index: usize, hits: Arc<Matches>) {
        let bytes = hits.bytes() + 128;
        const BUDGET: usize = 8 * 1024 * 1024;
        if bytes > BUDGET || self.chapters.contains_key(&index) {
            return;
        }
        while self.bytes + bytes > BUDGET {
            if let Some((old, charge)) = self.fifo.pop_front() {
                self.chapters.remove(&old);
                self.bytes -= charge;
            } else {
                break;
            }
        }
        self.fifo.push_back((index, bytes));
        self.chapters.insert(index, hits);
        self.bytes += bytes;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_use_original_utf16_ranges_and_deduplicate_expansions() {
        let chapter =
            Chapter::parse("<p>😀<ruby>字<rt>zi</rt></ruby>ﬃ f f</p>".as_bytes()).unwrap();
        let hits = Matches::build(&chapter, &Finder::new("f"), &[]);
        assert_eq!(hits.len(), 3);
        assert_eq!(hits.window(0, 1)[0].ranges, vec![[3, 4]]);
        assert_eq!(hits.window(2, 128)[0].ranges, vec![[7, 8]]);
        assert!(hits.window(3, 1).is_empty());
        let rows = excerpts(&chapter.text, hits.window(2, 1), true);
        assert_eq!(String::from_utf16(&rows[0].context).unwrap(), "😀字ﬃ f f");
        let target = serde_json::to_value(&rows[0]).unwrap();
        assert_eq!(target["target"]["textOffset"], 4);
        assert_eq!(target["target"]["textHits"][0]["exactText"], "f");
        assert_eq!(target["target"]["before"], "😀字ﬃf");
    }

    #[test]
    fn keyword_windows_preserve_reading_order_and_prefer_phrase_duplicates() {
        let chapter = Chapter::parse(b"<body><p>b.ax</p><p>ab</p><p>a</p><p>b</p></body>").unwrap();
        let hits = Matches::build(
            &chapter,
            &Finder::new("ab"),
            &[Finder::new("a"), Finder::new("b")],
        );
        let rows = hits.window(0, 2);
        assert_eq!(hits.len(), 2);
        assert!(rows[0].keywords);
        assert_eq!(rows[0].ranges, vec![[2, 3], [0, 1]]);
        assert!(!rows[1].keywords);
        assert_eq!(rows[1].ranges, vec![[5, 7]]);
    }
}
