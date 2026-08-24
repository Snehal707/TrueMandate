# Source Span Indexing

## Canonical representation

`SourceSpan` uses **JavaScript UTF-16 code unit** offsets, identical to `String.prototype.slice(start, end)`.

```ts
raw.slice(span.start, span.end) === grounding.sourceText
```

Both `start`/`end` and exact `sourceText` must be preserved. Comparison is exact; neither side is NFC/NFD-normalized before equality.

## Implications

- Emoji and other supplementary-plane characters occupy **two** UTF-16 code units (surrogate pair). Offsets must account for that.
- Composed (`é` U+00E9) and decomposed (`e` + combining acute) forms are **different** strings; a span grounded on one form will not match the other.
- Callers must not silently normalize away the stored `sourceText` or re-index with code-point / grapheme offsets.
