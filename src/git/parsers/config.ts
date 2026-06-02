export interface ConfigEntry {
  key: string;
  value: string;
}

/**
 * Parse `git config --list -z` output. Each record is "key\nvalue" terminated
 * by NUL. Keys may repeat (multivar); we keep all entries in order.
 */
export function parseConfigListZ(output: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  for (const record of output.split("\0")) {
    if (record === "") {
      continue;
    }
    const nl = record.indexOf("\n");
    if (nl === -1) {
      // Valueless key (e.g. a bare flag) — represent as empty string.
      entries.push({ key: record, value: "" });
    } else {
      entries.push({ key: record.slice(0, nl), value: record.slice(nl + 1) });
    }
  }
  return entries;
}
