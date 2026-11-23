//! The reader's navigation contract counts visible Unicode scalars, whereas ranges use UTF-16.
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExactHit {
    start: usize,
    end: usize,
    exact_text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Target {
    text_offset: usize,
    text_snippet: String,
    matched_text: String,
    text_hits: Vec<ExactHit>,
    before: String,
    after: String,
}

pub(super) fn resolve(units: &[u16], ranges: &[[u32; 2]]) -> Target {
    let start = ranges.iter().map(|r| r[0]).min().unwrap() as usize;
    let end = ranges.iter().map(|r| r[1]).max().unwrap() as usize;
    let mut offsets = vec![0usize; end + 1];
    let mut points = Vec::new();
    let mut raw = 0;
    for point in char::decode_utf16(units.iter().copied()) {
        let point = point.expect("chapter text is valid UTF-16");
        if point != '\0' && !point.is_whitespace() {
            points.push(point);
        }
        raw += point.len_utf16();
        if raw <= end {
            offsets[raw] = points.len();
        }
        // 32 following points cover both the anchor snippet and 24-point occurrence context.
        if raw >= end && points.len() >= offsets[end] + 32 {
            break;
        }
    }
    let first = offsets[start];
    let last = offsets[end];
    let text_hits = ranges
        .iter()
        .map(|r| {
            let a = offsets[r[0] as usize];
            let b = offsets[r[1] as usize];
            ExactHit {
                start: a,
                end: b,
                exact_text: points[a..b].iter().collect(),
            }
        })
        .collect();
    Target {
        text_offset: first,
        text_snippet: points[first..(first + 32).min(points.len())]
            .iter()
            .collect(),
        matched_text: String::from_utf16(&units[start..end])
            .expect("aligned raw range")
            .replace('\0', "\n"),
        text_hits,
        before: points[first.saturating_sub(24)..first].iter().collect(),
        after: points[last..(last + 24).min(points.len())].iter().collect(),
    }
}
