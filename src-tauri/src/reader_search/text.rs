//! Visible XHTML for the reader. Unsupported documents go through the reader's existing HTML parser.
use icu_normalizer::ComposingNormalizer;
use roxmltree::{Document, Node, ParsingOptions};

pub(super) struct Chapter {
    pub text: String,
    pub normalized: String,
}

fn block(tag: &str) -> bool {
    matches!(
        tag,
        "address"
            | "article"
            | "aside"
            | "blockquote"
            | "body"
            | "caption"
            | "dd"
            | "div"
            | "dl"
            | "dt"
            | "figcaption"
            | "figure"
            | "footer"
            | "form"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "header"
            | "hr"
            | "li"
            | "main"
            | "nav"
            | "ol"
            | "p"
            | "pre"
            | "section"
            | "table"
            | "tbody"
            | "td"
            | "tfoot"
            | "th"
            | "thead"
            | "tr"
            | "ul"
    )
}

// A boundary is inserted between nonempty runs, including whitespace-only runs.
// br/hr also contribute an explicit boundary at either end of a chapter.
#[derive(Default)]
struct Visible {
    text: String,
    boundary_pending: bool,
}
impl Visible {
    fn boundary(&mut self) {
        if !self.text.ends_with('\0') {
            self.text.push('\0');
        }
        self.boundary_pending = false;
    }
    fn walk(&mut self, node: Node, depth: usize) -> Option<()> {
        if depth > 128 {
            return None;
        }
        if node.is_text() {
            if let Some(text) = node.text().filter(|s| !s.is_empty()) {
                if self.boundary_pending && !self.text.is_empty() {
                    self.boundary();
                }
                self.text.push_str(text);
                self.boundary_pending = false;
            }
            return Some(());
        }
        if !node.is_element() {
            return Some(());
        }
        let tag = node.tag_name().name().to_ascii_lowercase();
        let kind = node
            .attributes()
            .find(|a| {
                a.name() == "type" && &node.document().input_text()[a.range_qname()] == "epub:type"
            })
            .map(|a| a.value())
            .or_else(|| node.attribute("type"))
            .unwrap_or("");
        if matches!(
            tag.as_str(),
            "script" | "style" | "noscript" | "template" | "head" | "rt" | "rp" | "rtc"
        ) || node.has_attribute("hidden")
            || node
                .attribute("aria-hidden")
                .is_some_and(|v| v.trim().eq_ignore_ascii_case("true"))
            || kind
                .split_whitespace()
                .any(|v| v.eq_ignore_ascii_case("footnote"))
        {
            return Some(());
        }
        if tag == "br" || tag == "hr" {
            self.boundary();
            return Some(());
        }
        let is_block = block(&tag);
        if is_block {
            self.boundary_pending = true;
        }
        for child in node.children() {
            self.walk(child, depth + 1)?;
        }
        if is_block {
            self.boundary_pending = true;
        }
        Some(())
    }
}

impl Chapter {
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        // BOM UTF-16, HTML recovery, CDATA node identity and custom entities use the existing parser.
        let xml = std::str::from_utf8(bytes)
            .ok()?
            .trim_start_matches('\u{feff}');
        if xml.contains("<![CDATA[") || xml.contains("<!ENTITY") {
            return None;
        }
        let doc = Document::parse_with_options(
            xml,
            ParsingOptions {
                allow_dtd: true,
                nodes_limit: 160_000,
                ..Default::default()
            },
        )
        .ok()?;
        let mut visible = Visible::default();
        visible.walk(doc.root_element(), 0)?;
        let text = visible.text;
        let mut normalized = String::with_capacity(text.len());
        for_normalized(&text, |point, _| normalized.push(point));
        Some(Self { text, normalized })
    }
}

impl Chapter {
    pub(super) fn raw_byte_spans(&self) -> Vec<[u32; 2]> {
        let mut spans = Vec::with_capacity(self.normalized.len());
        for_normalized(&self.text, |c, raw| {
            spans.resize(spans.len() + c.len_utf8(), raw)
        });
        spans
    }
}

fn for_normalized(text: &str, mut emit: impl FnMut(char, [u32; 2])) {
    let nfkc = ComposingNormalizer::new_nfkc();
    let mut end = 0u32;
    for c in text.chars() {
        let start = end;
        end += c.len_utf16() as u32;
        if c.is_whitespace() || c == '\u{ad}' {
            continue;
        }
        if c.is_ascii() || ('\u{4e00}'..='\u{9fff}').contains(&c) {
            emit(c.to_ascii_lowercase(), [start, end]);
        } else {
            for point in nfkc
                .normalize_iter(std::iter::once(c))
                .flat_map(char::to_lowercase)
            {
                if !point.is_whitespace() && point != '\u{ad}' {
                    emit(point, [start, end]);
                }
            }
        }
    }
}
