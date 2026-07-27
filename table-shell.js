// table-shell v1.1 -- shared VENDORED module. The fiscal site holds the
// canonical copy; the enrollment site carries a byte-identical vendor of it.
// A change to one is a change to both, in the same commit, with this version
// line bumped -- the version line is the drift alarm. v1.1 IS that vendoring:
// the extraction that produced this module deferred the fiscal copy, so for a
// while the file lived only on the enrollment side and the alarm had nothing
// to compare against. No mechanic changed between v1.0 and v1.1.
//
// table-shell.js -- shared sortable data-table renderer (the fiscal table shell).
// Owns the RENDER + sort-interaction MECHANICS only (header
// buttons, caret placement, aria-sort, focus-return, zebra/sorted classes,
// keyboard-scrollable region). It does NOT own the data, the sort comparison,
// or any page-specific cell content -- the caller passes already-sorted rows,
// the current sort state, an onSort callback, and per-column cell renderers.
//
// column shape (all optional except key + label):
//   { key, label,
//     align: "left" | "center" | "right"   (default "right"; drives text-align,
//                                            caret side, and the ta-* class),
//     numeric: bool                          (adds .num to default text cells),
//     sortable: bool                         (default true; false => static header),
//     ariaLabel: string                      (button aria-label; default `Sort by ${label}`),
//     title: string                          (button title tooltip),
//     renderHeaderContent: () => Node         (rich header label, e.g. a gloss span),
//     renderCell: (row) => (Node | string)    (a full <td> is used as-is; any other
//                                              Node is appended into a shell <td>;
//                                              a string/number becomes its text) }
//
// renderSortableTable({ table, columns, rows, sortState, onSort })
//   table     : the <table> element to fill (its contents are replaced)
//   columns   : column config array (above)
//   rows      : rows in final display order (caller sorts before calling)
//   sortState : { key, dir: "asc" | "desc" }
//   onSort    : (key) => void  -- caller updates its own sort state, re-sorts,
//               and calls renderSortableTable again (synchronously)

export function renderSortableTable({ table, columns, rows, sortState, onSort }) {
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");

  for (const c of columns) {
    const align = c.align || "right";
    const th = document.createElement("th");
    th.className = `col-${c.key}`;
    if (align !== "right") th.classList.add(`ta-${align}`);
    th.setAttribute("scope", "col");

    // Non-sortable column: a plain static header, no button.
    if (c.sortable === false) {
      th.classList.add("col-header-static");
      const span = document.createElement("span");
      if (c.renderHeaderContent) span.appendChild(c.renderHeaderContent());
      else span.textContent = c.label;
      th.appendChild(span);
      hr.appendChild(th);
      continue;
    }

    const active = sortState.key === c.key;
    if (active) {
      th.classList.add("col-sorted");
      th.setAttribute("aria-sort", sortState.dir === "asc" ? "ascending" : "descending");
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "th-sort";
    const labelNode = c.renderHeaderContent ? c.renderHeaderContent() : document.createTextNode(c.label);
    const arrow = document.createElement("span");
    arrow.className = active ? "sort-arrow active" : "sort-arrow";
    arrow.textContent = active ? (sortState.dir === "asc" ? "↑" : "↓") : "⇅";
    arrow.setAttribute("aria-hidden", "true");
    // Right-aligned (numeric) headers: caret LEFT of the label so the label's
    // right edge lines up over the column's values. Left/centre: caret after.
    if (align === "right") { btn.appendChild(arrow); btn.appendChild(labelNode); }
    else { btn.appendChild(labelNode); btn.appendChild(arrow); }
    btn.setAttribute("aria-label", c.ariaLabel || `Sort by ${c.label}`);
    if (c.title) btn.title = c.title;

    btn.addEventListener("click", () => {
      onSort(c.key);
      // onSort re-rendered the table synchronously; put focus back on the new
      // instance of this same header button so keyboard sorting doesn't drop focus.
      table.querySelector(`thead th.col-${c.key} button.th-sort`)?.focus();
    });
    th.appendChild(btn);
    hr.appendChild(th);
  }
  thead.appendChild(hr);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const c of columns) {
      const align = c.align || "right";
      const out = c.renderCell ? c.renderCell(row) : null;
      let td;
      if (out instanceof HTMLElement && out.tagName === "TD") {
        // Cell renderer built its own <td> (e.g. a sparkline or caveat-marks cell).
        td = out;
        td.classList.add(`col-${c.key}`);
        if (align !== "right") td.classList.add(`ta-${align}`);
      } else {
        td = document.createElement("td");
        td.className = `col-${c.key}`;
        if (align !== "right") td.classList.add(`ta-${align}`);
        if (c.numeric) td.classList.add("num");
        if (out instanceof HTMLElement) td.appendChild(out);
        else td.textContent = out == null ? (row[c.key] ?? "—") : out;
      }
      if (sortState.key === c.key) td.classList.add("col-sorted");
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.replaceChildren(thead, tbody);
}

// ---------------------------------------------------------------------------
// CSV download helpers (used by the enrollment table pages' "Download CSV"
// button; additive to this module -- the render path above is unchanged). The
// fiscal table pages keep their own CSV writers: theirs emit LF and no BOM, so
// adopting these would change the bytes of a file readers already download.
// Nothing is fetched or sent anywhere: each page builds its rows in-page from
// data it has already loaded, so this stays pure presentation, same as the
// render code.
// ---------------------------------------------------------------------------

// Quote one field per RFC 4180: wrap in double quotes and double any embedded
// quote whenever the value contains a comma, quote, CR, or LF; leave plain
// values (including the "→"/"(%)" header text, which has none of those)
// untouched, so a header row round-trips byte-for-byte. null/undefined -> "".
export function csvEscape(value) {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Build CSV text from an array of rows (each row an array of fields; row 0 is
// the header) and trigger a client-side download. CRLF line endings + a
// leading UTF-8 BOM so Excel reads the em-dash/arrow glyphs in the headers as
// UTF-8 rather than mojibake. The object URL is revoked immediately after the
// synthetic click so it doesn't leak.
export function downloadCsv(filename, rows) {
  const text = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
