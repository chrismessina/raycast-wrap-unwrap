// src/lib/classify.ts

export type BlockquoteFrame = { marker: ">"; spaceAfter: boolean };

export type InnerRole =
  | "blank"
  | "fence-boundary"
  | "in-fence"
  | "indented-code"
  | "heading-atx"
  | "heading-setext"
  | "hr"
  | "list-item"
  | "table-row"
  | "html-block"
  | "link-ref-def"
  | "prose";

export type Classified = {
  /** Outer-to-inner blockquote frames. Depth = prefixes.length. */
  prefixes: BlockquoteFrame[];
  role: InnerRole;
  /** Line content with all prefixes stripped. */
  content: string;
  /** Exact prefix string as it appeared in the input — used for round-trip emission. */
  rawPrefix: string;
  // role-specific extras:
  listMarker?: string;
  hangIndent?: number;
  taskState?: " " | "x" | "X";
  fenceChar?: "`" | "~";
  fenceLen?: number;
  hardBreak?: "spaces" | "backslash";
};

export function classify(text: string): Classified[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.map((line) => ({
    prefixes: [],
    role: "prose" as InnerRole,
    content: line,
    rawPrefix: "",
  }));
}
