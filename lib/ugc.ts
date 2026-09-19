// Parses an NWS UGC (Universal Geographic Code) block into zone IDs.
//
//   "NCZ203-192100-"                   → ["NCZ203"]
//   "NCZ195-196-203>205-VAZ098-192100-" → ["NCZ195","NCZ196","NCZ203","NCZ204","NCZ205","VAZ098"]
//
// A code sets a state+type prefix that carries forward to bare numbers,
// ">" expands a range, and a trailing 6-digit DDHHMM token is the expiry.

export function parseUgc(block: string): string[] {
  const tokens = block.replace(/\s+/g, '').split('-').filter(Boolean);
  const zones: string[] = [];
  let prefix = '';

  const pushRange = (from: number, to: number) => {
    for (let n = from; n <= to; n++) zones.push(prefix + String(n).padStart(3, '0'));
  };

  for (const tok of tokens) {
    let m: RegExpMatchArray | null;
    if ((m = tok.match(/^([A-Z]{2}[CZ])(\d{3})>(\d{3})$/))) {
      prefix = m[1];
      pushRange(+m[2], +m[3]);
    } else if ((m = tok.match(/^([A-Z]{2}[CZ])(\d{3})$/))) {
      prefix = m[1];
      zones.push(prefix + m[2]);
    } else if ((m = tok.match(/^(\d{3})>(\d{3})$/)) && prefix) {
      pushRange(+m[1], +m[2]);
    } else if (/^\d{6}$/.test(tok)) {
      break; // expiry time ends the block
    } else if ((m = tok.match(/^(\d{3})$/)) && prefix) {
      zones.push(prefix + m[1]);
    }
  }
  return [...new Set(zones)];
}
