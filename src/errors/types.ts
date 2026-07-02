// Append-only registry of every diagnostic code emitted by this stage.
// A code is permanent — never reused, never renumbered, never deleted.
// To retire one, set retired: true and leave the row in the YAML.

export type Category = 'lexical' | 'syntactic' | 'name' | 'type' | 'runtime';

export interface ErrorEntry {
  code: string;
  name: string;
  category: Category;
  summary: string;
  retired?: boolean;
}
