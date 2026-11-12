function extractJSONAssignment(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(escaped + '\\s*=\\s*').exec(html);
  if (!match) return null;
  const start = match.index + match[0].length;
  if (html[start] !== '{' && html[start] !== '[') throw Error('Assignment is not JSON');
  let depth = 0, quoted = false, escape = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw Error('Truncated JSON assignment');
}

module.exports = { extractJSONAssignment };
