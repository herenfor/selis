/** Ruby annotations and fallback parentheses are outside the searchable base text. */
export const RUBY_ANNOTATION_TAGS = ["rt", "rp", "rtc"] as const;
export const RUBY_ANNOTATION_SELECTOR = RUBY_ANNOTATION_TAGS.join(",");
