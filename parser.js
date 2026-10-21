/**
 * Prerequisite expression engine.
 * Grammar (AND binds tighter than OR; parentheses override):
 *   expr    := term ( "OR" term )*
 *   term    := factor ( "AND" factor )*
 *   factor  := COURSE_CODE | "(" expr ")"
 * Example: "(CS 171 AND CS 172) OR INFO 152"
 */

/** Normalizes "cs171", "CS  171" and "cs 171" to "CS 171". */
export function normalizeCode(code) {
  return String(code).trim().toUpperCase().replace(/([A-Z]+)\s*(\d)/, "$1 $2").replace(/\s+/g, " ");
}

/** Splits an expression into "(", ")", "AND", "OR" and normalized course codes. */
function tokenize(src) {
  const s = src.toUpperCase();
  const re = /\s*(\(|\)|\bAND\b|\bOR\b|[A-Z]{2,5}\s*\d{3}[A-Z]?)/y;
  const tokens = [];
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) {
      const rest = s.slice(pos).trim();
      if (!rest) break; // trailing whitespace only
      throw new SyntaxError(`Unexpected text near "${rest.slice(0, 12)}"`);
    }
    const t = m[1];
    tokens.push(/^(\(|\)|AND|OR)$/.test(t) ? t : normalizeCode(t));
    pos = re.lastIndex;
  }
  return tokens;
}

/**
 * Evaluates a prerequisite string against a Set of completed course codes
 * (codes should be normalized, e.g. "CS 171").
 * An empty expression means "no prerequisites" and returns true.
 * Throws SyntaxError if the expression is malformed.
 */
export function evaluatePrereqs(prereqString, completedCoursesSet) {
  if (!prereqString || !prereqString.trim()) return true;
  const t = tokenize(prereqString);
  let i = 0;

  const expr = () => { let v = term(); while (t[i] === "OR") { i++; const r = term(); v = v || r; } return v; };
  const term = () => { let v = factor(); while (t[i] === "AND") { i++; const r = factor(); v = v && r; } return v; };
  const factor = () => {
    const tok = t[i++];
    if (tok === "(") {
      const v = expr();
      if (t[i++] !== ")") throw new SyntaxError("Missing closing parenthesis");
      return v;
    }
    if (tok === undefined || tok === ")" || tok === "AND" || tok === "OR") throw new SyntaxError("Expected a course code");
    return completedCoursesSet.has(tok);
  };

  const result = expr();
  if (i < t.length) throw new SyntaxError(`Unexpected "${t[i]}"`);
  return result;
}

/** Returns an error message for a malformed expression, or null if it is valid. */
export function validatePrereqs(prereqString) {
  try { evaluatePrereqs(prereqString, new Set()); return null; }
  catch (err) { return err.message; }
}
