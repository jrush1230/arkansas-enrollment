import {
  loadDistricts,
  districtAriaLabel,
  districtShapeSentence,
  districtCagrDetail,
  sparklineSvg,
  sparklineBoundaryNote,
  thinBaselineIcon,
  boundaryChangedIcon,
  reversalIcon,
  makeCaveatsMark,
  pctChangeColor,
  GRADIENT_ANCHORS,
  shortName,
  glossaryAriaLabel,
  GLOSSARY,
} from "./shared.js";
import { renderSortableTable, downloadCsv } from "./table-shell.js";

// Magnitude bucket filter -- Declining/Stable/Growing are now defined by
// pct_change_efa_era's own value, not by typology-ramp membership. The old
// version bucketed by typology (first 4 categories = "growing," etc.),
// which let a district like Pottsville (typology growth_stalled, a
// "growing" category) land in the Growing bucket while its own displayed
// percentage was -1.3% -- a real, visible contradiction between a row's
// bucket and its own number. This can't happen anymore: every bucket's
// membership is directly a function of the same pct_change_efa_era shown
// on the row.
//
// +-2% threshold, chosen from the real distribution across all 235
// districts (computed 2026-07-13): min -38.2%, p10 -13.0%, p25 -8.5%,
// median -5.0%, p75 -1.0%, p90 +3.9%, p95 +6.8%, max +15.8%. At +-2%:
// declining=159, stable=44, growing=32 (235 total). Declining dominates
// (68%) because that's the real shape of this data -- Arkansas-wide
// EFA-era decline, already established via the map's color-scale work --
// not an artifact of where the threshold landed; +-1% (stable=18, feels
// too thin to read as a real "roughly flat" band) and +-3%
// (stable=63/27%, starts absorbing districts closer to the -5% median
// decline than to flat) were checked and rejected in favor of +-2% as the
// cleanest round number giving Stable a legible, non-trivial slice
// without pulling in genuinely-declining districts.
const STABLE_THRESHOLD = 0.02;

// colorKey indexes into shared.js's GRADIENT_ANCHORS (same green/yellow/red
// anchors the map's continuous fill uses) -- a magnitude-based bucket
// pairs naturally with the magnitude-based gradient, unlike the old
// typology-based buckets which had no principled color of their own.
const MAGNITUDE_BUCKETS = {
  all: { label: "All", colorKey: null, matches: () => true },
  declining: {
    label: `Declining (< -${STABLE_THRESHOLD * 100}%)`,
    colorKey: "red",
    matches: (pct) => typeof pct === "number" && pct <= -STABLE_THRESHOLD,
  },
  stable: {
    label: `Stable (±${STABLE_THRESHOLD * 100}%)`,
    colorKey: "yellow",
    matches: (pct) => typeof pct === "number" && pct > -STABLE_THRESHOLD && pct < STABLE_THRESHOLD,
  },
  growing: {
    label: `Growing (> +${STABLE_THRESHOLD * 100}%)`,
    colorKey: "green",
    matches: (pct) => typeof pct === "number" && pct >= STABLE_THRESHOLD,
  },
};
const MAGNITUDE_BUCKET_ORDER = ["all", "declining", "stable", "growing"];

function currentMode() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function fmtPct(v) {
  return v == null ? "—" : (v * 100).toFixed(1) + "%";
}
function fmtMagnitude(v) {
  return v ? v[0].toUpperCase() + v.slice(1) : "—";
}

// Everything the simplified row no longer shows by default -- the shape
// sentence, badge text, and the baseline/EFA CAGR numeric detail -- now
// lands here instead, in that order. districtShapeSentence() (not
// typologyLabel()) is the primary shape description -- a reader shouldn't
// need to already know what "growth_stalled" means, same reasoning that
// put this sentence on the drill-down page in the first place. Always
// non-empty, so the tooltip fires for every row, not just ones with a
// CAGR detail to show. districtCagrDetail()'s numeric rates no longer
// carry their own growing/flat/declining annotation (see shared.js) --
// the sentence already says that in words, so the two lines aren't
// repeating each other. sparklineBoundaryNote() (shared.js) appends the
// sparkline's boundary-change omission sentence for the 7 exception
// districts -- the row's own sparkline (see the Trajectory cell below) is
// decorative (aria-hidden), so this tooltip/the row link's aria-label are
// the only place that omission is ever stated, same shared wording the
// data table's cell label uses for the identical visual.
function tooltipText(d) {
  const segments = [districtShapeSentence(d)];
  const badgeText = badgeTexts(d);
  if (badgeText.length) segments.push(`${badgeText.join(". ")}.`);
  const detail = districtCagrDetail(d);
  if (detail) segments.push(detail);
  const boundaryNote = sparklineBoundaryNote(d).trim();
  if (boundaryNote) segments.push(boundaryNote);
  return segments.join(" ");
}

// One shared tooltip element for the whole table (same idiom as the
// statewide line's single #tooltip div) rather than one per row -- shown on
// whichever row is currently hovered or focused. Same content
// districtAriaLabel()/the row link's own aria-label already carry for
// keyboard/screen-reader users, so this is a second rendering of one
// channel, not a separate one. Positioned against #rank-table-wrap, the
// wrapper AROUND .table-scroll rather than the scroll box itself -- that
// box is overflow-x:auto, so a tooltip inside it would be clipped at the
// box edge and would slide sideways with the table.
function showRowTooltip(rowEl, d) {
  const tooltip = document.getElementById("row-tooltip");
  const wrap = document.getElementById("rank-table-wrap");
  tooltip.textContent = tooltipText(d);
  const wrapRect = wrap.getBoundingClientRect();
  const rowRect = rowEl.getBoundingClientRect();
  tooltip.style.left = "6px";
  tooltip.style.top = `${rowRect.bottom - wrapRect.top + 2}px`;
  tooltip.style.opacity = "1";
}

function hideRowTooltip() {
  document.getElementById("row-tooltip").style.opacity = "0";
}

// Single source of truth for badge text, shared by the row tooltip and
// the aria-label -- badge info was visual-only before this fix (never
// reached districtAriaLabel() in any prior round), a real gap for
// screen-reader users on any of the 7 boundary-change districts or the
// several thin-baseline/reversal ones, found while re-testing the badge
// wrap fix below.
function badgeTexts(d) {
  const texts = [];
  // Guarantees a null-typology district still gets SOME accessible signal
  // even if it happens to have no other caveat true -- without this, a
  // district with e.g. baseline_years_thin=false would get an empty
  // badgeText array and render as an ordinary-looking row with only an
  // oddly-worded tooltip, no "something to check" signal at all. (No
  // dedicated visual icon exists for this case, matching the data
  // table's own Notes column -- "Not yet classified" is
  // tooltip/aria-label-only, same as there; today all 235 districts
  // classify, so this is a defensive guard against a FUTURE district,
  // not something a current row visually needs to mark.)
  if (!d.typology) texts.push("Not yet classified");
  if (d.baseline_years_thin) texts.push("Thin baseline");
  if (d.reversal_magnitude) texts.push(`${fmtMagnitude(d.reversal_magnitude)} reversal`);
  // Disclosure, not a warning: this district's baseline may reflect a
  // different (pre-merger, smaller) boundary than today's -- see the
  // methodology page. Doesn't imply anything about classification
  // correctness, unlike the other two badges which flag data thinness.
  if (d.boundary_change_within_series) texts.push(`Boundary changed ${d.current_boundary_since}`);
  return texts;
}

// Full accessible text for the row, carried by the District cell's link
// (which is the row's only focusable element, so it is where a keyboard
// user actually lands). districtAriaLabel() is shared across
// map.js/drill-down.js too, so the badge text and the sparkline's
// boundary-change note are appended HERE rather than added inside that
// shared function -- extending the shared function would silently change
// those other two views' aria-labels as a side effect. Reuses
// sparklineBoundaryNote(d) verbatim (not a second, hand-typed copy of the
// same sentence) so the tooltip and this aria-label can't drift apart.
function rowAriaLabel(d) {
  const badgeText = badgeTexts(d);
  const extras = [badgeText.length ? `${badgeText.join(". ")}.` : "", sparklineBoundaryNote(d).trim()]
    .filter(Boolean)
    .join(" ");
  return extras ? `${districtAriaLabel(d)} ${extras}` : districtAriaLabel(d);
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

// District cell: the magnitude swatch plus the drill-down link. Magnitude,
// not shape: the same pctChangeColor() gradient the map's fill uses, keyed
// to this row's own pct_change_efa_era -- not typologyColor(), which
// school-districts.js's Trajectory column still uses unchanged.
// dataset.typology is kept as metadata (unrelated to which color renders)
// since any future styling here might still key off it.
function makeNameCell(d) {
  const td = document.createElement("td");
  const inner = document.createElement("span");
  inner.className = "name-inner";

  const swatch = document.createElement("span");
  swatch.className = "row-swatch";
  swatch.dataset.typology = d.typology ?? "";
  swatch.style.background = pctChangeColor(d.pct_change_efa_era, currentMode());
  swatch.setAttribute("aria-hidden", "true");
  inner.appendChild(swatch);

  const a = document.createElement("a");
  a.href = `drill-down.html?id=${encodeURIComponent(d.id)}`;
  a.textContent = shortName(d.name);
  // Full name in the native tooltip, since the visible text ellipsises at
  // narrow widths -- same title-on-the-link treatment school-districts.js
  // gives its own District cell.
  a.title = d.name;
  a.setAttribute("aria-label", rowAriaLabel(d));
  inner.appendChild(a);

  td.appendChild(inner);
  return td;
}

// Notes cell -- the same shared.js icon builders (thinBaselineIcon()/
// boundaryChangedIcon()/reversalIcon()) and per-mark hover-title wrapper
// (makeCaveatsMark()) the School Districts table's Notes column uses, not
// reimplemented. Only active flags render (nothing for a clean row, the
// same "no all-clear placeholder" convention that table already
// established). Every mark is purely visual (aria-hidden, inherited from
// makeCaveatsMark()) -- the District link's aria-label (badgeTexts(),
// above) remains the sole accessible channel, exactly as it was on the
// ranked-list rows; these per-mark titles are an ADDITIONAL sighted-hover
// channel on top of it, not a replacement.
function makeCaveatsCell(d) {
  const td = document.createElement("td");
  td.className = "cell-caveats";
  if (d.baseline_years_thin) {
    td.appendChild(makeCaveatsMark(thinBaselineIcon(), "Thin baseline"));
  }
  if (d.reversal_magnitude) {
    td.appendChild(makeCaveatsMark(
      reversalIcon(d.reversal_magnitude),
      `${fmtMagnitude(d.reversal_magnitude)} reversal`
    ));
  }
  if (d.boundary_change_within_series) {
    td.appendChild(makeCaveatsMark(boundaryChangedIcon(), `Boundary changed: ${d.current_boundary_since}`));
  }
  return td;
}

// Trajectory sparkline -- same shared.js function, same 2013-2025 window,
// same per-district scaling, same boundary-change-district handling as the
// School Districts table's Trajectory column; imported rather than
// reimplemented. Purely decorative (aria-hidden) -- the row tooltip and
// the District link's aria-label are the accessible channel for what this
// line shows, the same division of labor the ranked list already used.
function makeTrajectoryCell(d) {
  const td = document.createElement("td");
  td.className = "cell-typology-visual";
  const spark = sparklineSvg(d, currentMode());
  spark.setAttribute("aria-hidden", "true");
  td.appendChild(spark);
  return td;
}

// How many of the three caveat flags are active on a district -- the sort
// key for the Notes column, same derivation (and same reasoning) as
// school-districts.js's caveatCount().
function caveatCount(d) {
  return (d.baseline_years_thin ? 1 : 0) +
    (d.reversal_magnitude ? 1 : 0) +
    (d.boundary_change_within_series ? 1 : 0);
}

async function main() {
  const districts = await loadDistricts();

  // Every district classifies today (data_status='ok' for all 235,
  // confirmed via the v3 rebuild's diff against the locked typology
  // output) -- the insufficient_history separated-section treatment this
  // view originally needed for Pine Bluff was removed as dead code
  // post-fix. A FUTURE null-typology district still needs no special
  // handling here: the only filter axis left is the magnitude bucket
  // (declining/stable/growing), which is keyed to pct_change_efa_era, a
  // real number for every district regardless of classification status
  // (see 12_build_districts_json.py -- EFA-era coverage is universal) --
  // so a null-typology district is always correctly bucketable by its own
  // actual percentage, typology-independent by construction, nothing to
  // special-case. badgeTexts() still always flags "Not yet classified" in
  // the row's aria-label regardless of classification.

  let activeBucketKey = "all";
  let searchText = "";
  // Sort state, in the shared shell's grammar (key + asc/desc) rather than
  // the old single decline/growth toggle. "rank" ascending is the same
  // order that toggle's default produced -- steepest EFA-era decline
  // first -- and "rank" descending is the same order its "growth" state
  // produced, so the page opens on, and can still reach, exactly the two
  // orderings it had before. What is new is that District, Notes and EFA
  // change now sort too, which is what putting this view on the shared
  // table shell buys.
  let sortKey = "rank";
  let sortDir = "asc";

  function matchesSearch(d) {
    return d.name.toLowerCase().includes(searchText.trim().toLowerCase());
  }

  // Rank is assigned over the FILTERED set, not all 235 -- the ranked list
  // always renumbered from 1 inside a filter, and that is the more useful
  // reading ("steepest decline among the districts I'm looking at").
  // Assigned once per filter change, from the EFA-change ordering alone,
  // so it is a stable property of the row: sorting by District or Notes
  // reorders the rows but each keeps the rank it earned. Nulls sort last
  // here for the same reason they do in every other numeric column, though
  // no district has a null pct_change_efa_era today.
  function rankedRows() {
    const bucket = MAGNITUDE_BUCKETS[activeBucketKey];
    const rows = districts.filter((d) => bucket.matches(d.pct_change_efa_era) && matchesSearch(d));
    const byChange = [...rows].sort((a, b) => {
      const av = a.pct_change_efa_era, bv = b.pct_change_efa_era;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv;
    });
    const ranks = new Map();
    byChange.forEach((d, i) => ranks.set(d.id, i + 1));
    return rows.map((d) => ({ d, rank: ranks.get(d.id) }));
  }

  function compareRows(a, b) {
    let cmp;
    if (sortKey === "rank") {
      cmp = a.rank - b.rank;
    } else if (sortKey === "name") {
      // Sorts on the SHORT name -- the text the cell actually shows -- not
      // on the full district_name. The two disagree for three real pairs
      // (Ouachita/Ouachita River, Ozark/Ozark Mountain, Searcy/Searcy
      // County): full-name order puts "OUACHITA RIVER SCHOOL DISTRICT"
      // before "OUACHITA SCHOOL DISTRICT", which on screen reads as
      // "OUACHITA RIVER" above "OUACHITA" -- an order the visible column
      // contradicts. school-districts.js sorts on the full name and has the
      // same three inversions; that is fixed in its own commit rather than
      // silently here, so the two pages agree again afterwards.
      cmp = shortName(a.d.name).localeCompare(shortName(b.d.name));
    } else if (sortKey === "caveats") {
      cmp = caveatCount(a.d) - caveatCount(b.d);
    } else {
      const av = a.d[sortKey], bv = b.d[sortKey];
      const aNull = av == null, bNull = bv == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1;  // nulls always sort last, regardless of direction
      if (bNull) return -1;
      cmp = av - bv;
    }
    return sortDir === "asc" ? cmp : -cmp;
  }

  // Column config in the shared shell's shape. Trajectory is the only
  // non-sortable column, same call school-districts.js makes for the same
  // visual: a sparkline has no scalar to rank by.
  const columns = [
    {
      key: "rank", label: "Rank", align: "right", numeric: true,
      ariaLabel: glossaryAriaLabel("Sort by Rank", "efaChange"),
      title: GLOSSARY.efaChange,
      renderCell: (r) => String(r.rank),
    },
    {
      key: "name", label: "District", align: "left",
      renderCell: (r) => makeNameCell(r.d),
    },
    {
      key: "caveats", label: "Notes", align: "center",
      renderCell: (r) => makeCaveatsCell(r.d),
    },
    {
      key: "typology", label: "Trajectory", align: "center", sortable: false,
      renderCell: (r) => makeTrajectoryCell(r.d),
    },
    {
      key: "pct_change_efa_era", label: "EFA change", align: "right", numeric: true,
      ariaLabel: glossaryAriaLabel("Sort by EFA change", "efaChange"),
      title: GLOSSARY.efaChange,
      renderCell: (r) => fmtPct(r.d.pct_change_efa_era),
    },
  ];

  // The shell renders rows; it does not own per-row interaction, so the
  // hover/focus tooltip wiring is re-attached here after every render.
  // focusin/focusout (not focus/blur) because the focusable element is the
  // District link INSIDE the row -- those two bubble, focus/blur do not.
  function attachRowTooltips(table, rows) {
    table.querySelectorAll("tbody tr").forEach((tr, i) => {
      const d = rows[i].d;
      tr.addEventListener("mouseenter", () => showRowTooltip(tr, d));
      tr.addEventListener("mouseleave", hideRowTooltip);
      tr.addEventListener("focusin", () => showRowTooltip(tr, d));
      tr.addEventListener("focusout", hideRowTooltip);
    });
  }

  function renderTable() {
    hideRowTooltip(); // a row mid-render may be removed by the new filter/sort without a mouseleave/blur ever firing
    const table = document.getElementById("rank-table");
    const rows = rankedRows().sort(compareRows);
    renderSortableTable({
      table,
      columns,
      rows,
      sortState: { key: sortKey, dir: sortDir },
      onSort: (key) => {
        if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
        else { sortKey = key; sortDir = "asc"; }
        renderTable();
      },
    });
    attachRowTooltips(table, rows);

    document.getElementById("result-count").textContent =
      `Showing ${rows.length} of ${districts.length} districts`;
  }

  // JS-rendered (not static markup) so each pill's label can be derived
  // straight from STABLE_THRESHOLD -- one place defines the number, same
  // pattern as everywhere else in this file that avoids re-listing a
  // constant. Colors come from GRADIENT_ANCHORS, not typologyColor() --
  // this is the magnitude channel, same one the map's fill and the row's
  // own swatch already use, not the categorical one.
  function renderBucketToggle() {
    const container = document.getElementById("bucket-toggle");
    container.textContent = "";
    const mode = currentMode();
    for (const key of MAGNITUDE_BUCKET_ORDER) {
      const { label, colorKey } = MAGNITUDE_BUCKETS[key];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.bucket = key;
      btn.setAttribute("aria-pressed", String(key === activeBucketKey));
      if (colorKey) {
        const sw = document.createElement("span");
        sw.className = "bucket-swatch";
        sw.style.background = GRADIENT_ANCHORS[mode][colorKey];
        btn.appendChild(sw);
        btn.style.borderColor = GRADIENT_ANCHORS[mode][colorKey];
      }
      btn.appendChild(document.createTextNode(label));
      btn.addEventListener("click", () => {
        activeBucketKey = key;
        renderBucketToggle();
        renderTable();
      });
      container.appendChild(btn);
    }
  }

  // Download CSV -- the districts currently shown, in the order currently
  // shown, same convention school-districts.js's export uses. Columns
  // mirror the visible table 1:1 EXCEPT Trajectory (a sparkline has no
  // scalar to export) and Notes, which is expanded from its icons into
  // three spelled-out columns (Thin baseline "Yes"/blank, Reversal
  // magnitude "Large"/blank, Boundary changed "2015"/blank) so the file is
  // self-describing without the on-screen legend. The percentage is the
  // same 1-decimal figure shown on screen, minus the "%" (the header
  // carries the "(%)" unit instead); a null exports as an empty field, not
  // "—". All in-page, from data already loaded -- no fetch, nothing sent
  // anywhere.
  function exportCsv() {
    const pct = (v) => (v == null ? "" : (v * 100).toFixed(1));
    const header = [
      "Rank", "District", "EFA change (%)",
      "Thin baseline", "Reversal magnitude", "Boundary changed",
    ];
    const body = rankedRows().sort(compareRows).map(({ d, rank }) => [
      rank,
      d.name,
      pct(d.pct_change_efa_era),
      d.baseline_years_thin ? "Yes" : "",
      d.reversal_magnitude ? fmtMagnitude(d.reversal_magnitude) : "",
      d.boundary_change_within_series ? d.current_boundary_since : "",
    ]);
    downloadCsv("district-rankings.csv", [header, ...body]);
  }

  document.getElementById("search-input").addEventListener("input", (evt) => {
    searchText = evt.target.value;
    renderTable();
  });
  document.getElementById("dl-csv").addEventListener("click", exportCsv);

  renderBucketToggle();
  renderTable();

  // Re-derive swatch/pill/sparkline colors on a live OS theme change
  // without a data reload.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    renderBucketToggle();
    renderTable();
  });
}

main();
