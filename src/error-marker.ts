export interface Position {
  offset: number;  // 0-based index into the source string
  line: number;    // 1-based
  column: number;  // 1-based
}

export interface Span {
  start: Position;
  end: Position;   // exclusive — points one past the last character
}

export interface ErrorMarker {
  code: string;
  span: Span;
}
