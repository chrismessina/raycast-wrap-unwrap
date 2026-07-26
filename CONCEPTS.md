# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Relationships

Classification is the substrate everything else stands on: both transforms turn text into an ordered series of Classified Lines, decide per line whether its Role is reflowable, and re-emit. A Classified Line owns its Quote Frames and its Role; a Reflow Group owns the consecutive Classified Lines being merged. Round-Trip Fidelity is the invariant that binds the two transforms together — neither is correct alone, only as inverses of each other.

## Classification

### Classified Line
One input line after parsing, carrying its Role, its stack of Quote Frames, its content with those frames stripped, and the verbatim prefix text needed to reproduce the original line. Classification is line-oriented: every input line yields exactly one Classified Line, and no downstream stage re-reads the raw text.

The verbatim prefix is kept alongside the parsed frames because the two answer different questions — the frames say *how deeply nested* a line is, the verbatim prefix says *exactly how it was written*. Grouping decisions use the frames; emission uses the verbatim prefix. Rebuilding a prefix from the frames instead silently discards indentation.

### Role
What a line *is* structurally — prose, a list item, a heading, a fence boundary, code inside a fence, a table row, and so on. Distinct from Quote Depth: a line has exactly one Role, describing its content, and separately sits at some depth inside quotes.

Only prose and list items are reflowable; every other Role is passed through verbatim. This is the central safety property of both transforms — code, tables, and headings are never rewrapped or merged.

### Quote Frame
One level of blockquote nesting on a line, recording the marker and whether a space followed it. A line's Quote Depth is its number of frames.

Whether a space follows the marker is presentation, not structure: `>text` and `> text` are the same quote and group together. Indentation *before* the marker is the opposite — it can mean the quote sits inside a list item, which makes it a different block from a quote at the margin.

## Reflow

### Reflow Group
A run of consecutive reflowable Classified Lines at the same structural position, merged into a single logical line during unwrapping. A group breaks at a blank line, at any non-reflowable Role, at a change of Quote Depth, or at a hard line break.

A group accumulates text as it grows, so it also carries the small pieces of state that would otherwise require re-reading that accumulation — the trailing characters, and whether the text so far ends inside an unterminated inline construct. Deriving those by inspecting the accumulated text per line is the quadratic trap this codebase has hit repeatedly.

### Inline Token
A span that must never be split or reinterpreted during reflow — a code span, a link, an autolink. Inline tokens are swapped for placeholders before line-breaking decisions and restored afterward, so a break can never land inside one.

Because the placeholder is itself text, input that happens to contain placeholder-shaped characters must be escaped before substitution and unescaped after, or the restore step will rewrite the user's own content.

### Soft Hyphen
The invisible character marking an optional line break inside a word, as distinct from a literal hyphen that is part of the spelling. Only a soft hyphen is safe to remove when rejoining a broken word; a literal hyphen is indistinguishable from a real compound and is always preserved.

### Round-Trip Fidelity
The invariant that wrapping text and then unwrapping it — or the reverse — returns the original, byte for byte. It is the primary correctness bar for both transforms, and the reason a change that improves one direction is not done until the other direction is re-checked.

Fidelity is what makes otherwise-cosmetic decisions load-bearing: a wrapped line that begins with a character sequence the classifier would read as a marker becomes a different Role on the way back, so the text no longer round-trips. Emitting is therefore constrained by what re-parsing will do, not only by what looks right.

## Flagged ambiguities

- *Role* and *Quote Depth* are orthogonal and were both loosely called "type" early on — a line has one Role and, independently, a depth. Prefer the two terms.
