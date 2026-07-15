import {
  COVID_YEARS,
  EFA_START,
  eraOf,
  eraLabel,
  schoolYearLabel,
  loadFullStatewideTotals,
  attachGlossaryNote,
} from "./shared.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MARGIN = { top: 28, right: 20, bottom: 36, left: 56 };
const VB_W = 880, VB_H = 420;
const PLOT_W = VB_W - MARGIN.left - MARGIN.right;
const PLOT_H = VB_H - MARGIN.top - MARGIN.bottom;

// Single-select tabs: exactly one series shown at a time (same interaction
// pattern as the earlier "227-district trend" / "Full statewide total"
// pill toggle). "Other" (DYS + Arkansas School for the Deaf and Blind) is
// deliberately not a tab -- it's small, doesn't tell its own story on a
// line chart, and stays fully visible in the table instead.
const SERIES = {
  all:      { field: "all",      label: "All student enrollment" },
  district: { field: "district", label: "Public school district enrollment" },
  charter:  { field: "charter",  label: "Public charter school enrollment" },
};
// "all" (the full statewide total -- districts + charters + other +
// predecessor) rather than "district" -- a first-time visitor should see
// the whole picture on load, not a district-only subset with no
// indication three other entity types exist until they notice the tabs.
// Changing this alone is NOT sufficient on its own: statewide.html's
// series-toggle buttons hardcode their initial aria-pressed state in
// static markup (initSeriesTabs() below only updates it reactively, on
// click), so that markup's initial pressed button was moved from
// tab-district to tab-all to match -- confirmed by testing, not assumed,
// since the two are otherwise silently independent and a mismatch here
// would show the All chart with the District button still visually
// (and to assistive tech) marked as selected.
const DEFAULT_SERIES = "all";

function fmtInt(n) {
  return Math.round(n).toLocaleString("en-US");
}

// "nice" tick step for a given rough range
function niceStep(rangeSize, targetTicks) {
  const rough = rangeSize / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let step;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  return step * mag;
}

async function main() {
  const fullTotals = await loadFullStatewideTotals();

  // Per year: all = every SIS entity; district = the 235 regular districts
  // (predecessor entities included pre-merger, see build script); charter =
  // charter schools; other = DYS + Arkansas School for the Deaf and Blind;
  // predecessor = real school districts that later merged into a current
  // district, counted here only for their own pre-merger years (e.g.
  // Dollarway before its 2021 merger into Pine Bluff) -- zero from 2021-22
  // onward, since by then all 6 post-2013 mergers have happened. Split out
  // from charter as its own bucket after predecessor districts' pre-merger
  // enrollment was found to be misclassified as charter (~22% overstatement
  // of 2013-14's charter_total) -- see build_full_statewide_totals.py.
  // all == district + charter + other + predecessor exactly, asserted at
  // build time.
  const points = fullTotals
    .slice()
    .sort((a, b) => a.year - b.year)
    .map((row) => ({
      year: row.year,
      era: eraOf(row.year),
      all: row.full_all_entities,
      district: row.full_235_equivalent,
      charter: row.charter_total,
      charterCount: row.charter_count,
      other: row.other_total,
      otherCount: row.other_count,
      predecessor: row.predecessor_total,
      predecessorCount: row.predecessor_count,
      nMatched: row.n_matched,
      totalN: 235,
      adeConfirmed: row.ade_confirmed,
    }));

  renderTableRows(points);
  initTableToggle();

  // Other/Predecessor's headers are static markup (never re-rendered), so
  // this runs once here rather than per-render like the data table's
  // equivalent -- see shared.js's GLOSSARY comment for the full map of
  // which persistent note copies this same wording (statewide.html's own
  // .table-note already explains both in prose; this adds the same
  // definitions as a hover/keyboard-reachable tooltip on the headers
  // themselves too).
  attachGlossaryNote(document.getElementById("th-other"), "other");
  attachGlossaryNote(document.getElementById("th-predecessor"), "predecessor");

  let currentSeries = DEFAULT_SERIES;
  function renderAll() {
    renderFootnote(points, currentSeries);
    renderChart(points, currentSeries);
  }
  initSeriesTabs((key) => {
    currentSeries = key;
    renderAll();
  });
  renderAll();
}

function renderFootnote(points, seriesKey) {
  const footnote = document.getElementById("footnote");
  const confirmedPoints = points.filter((p) => p.adeConfirmed);
  const unconfirmedPoints = points.filter((p) => !p.adeConfirmed);
  const last = points[points.length - 1];

  // yearRangeLabel(arr)[0].year threw unconditionally on an empty array --
  // a real, previously-latent crash: today 10 of 13 years are
  // ADE-confirmed and 3 aren't (ADE_CONFIRMED_YEARS,
  // build_full_statewide_totals.py), so neither confirmedPoints nor
  // unconfirmedPoints is empty YET, but that's a fact about today's data,
  // not a guarantee -- if the remaining 3 years ever get confirmed,
  // unconfirmedPoints becomes [], and the old unconditional
  // unconfirmedPoints[0].year would throw immediately, breaking every
  // footnote variant on the page (confirmed via a temporary in-memory
  // patch simulating all-13-confirmed, not assumed). Returns null for an
  // empty array instead; verificationClause() below branches on that.
  function yearRangeLabel(pts) {
    if (pts.length === 0) return null;
    return `${schoolYearLabel(pts[0].year)} through ${schoolYearLabel(pts[pts.length - 1].year)}`;
  }
  const confirmedRange = yearRangeLabel(confirmedPoints);
  const unconfirmedRange = yearRangeLabel(unconfirmedPoints);

  // Two ADE sources feed ADE_CONFIRMED_YEARS
  // (build_full_statewide_totals.py): 2016-17 onward via
  // myschoolinfo.arkansas.gov's State Report Card system; 2013-14 through
  // 2015-16 (added 2026-07-13) via a different official ADE portal,
  // adedata.arkansas.gov's "Enrollment Count by State" report -- the
  // Report Card portal has no data that far back. This is a fixed
  // historical fact about which portal covers which years, not something
  // derived at render time, so the 2016 threshold is hardcoded here
  // (matching the same split already documented in that script's own
  // comment) rather than carried as a per-year source field the data
  // doesn't have. Handles a future partial-confirmation state gracefully
  // too: whichever of the two sub-ranges is actually non-empty within
  // whatever's confirmed gets its own clause; the other is omitted
  // rather than printed with a "0 years" clause.
  const REPORT_CARD_START_YEAR = 2016;
  function sourceAttribution(pts) {
    const reportCard = pts.filter((p) => p.year >= REPORT_CARD_START_YEAR);
    const enrollmentCount = pts.filter((p) => p.year < REPORT_CARD_START_YEAR);
    const clauses = [];
    if (reportCard.length) {
      clauses.push(`${schoolYearLabel(reportCard[0].year)} onward via ADE's State Report Card system`);
    }
    if (enrollmentCount.length) {
      clauses.push(`${yearRangeLabel(enrollmentCount)} via ADE's Enrollment Count by State report`);
    }
    return clauses.join(", ");
  }

  // The "Verified against ... / N of M years not verified" pairing is
  // shared verbatim by the "district" and "all" variants below -- built
  // once here so both branch identically on the same three cases (all
  // confirmed, today's real case; partial; all unconfirmed) rather than
  // duplicating the same conditional twice and risking the two variants
  // drifting apart.
  function verificationClause() {
    if (unconfirmedPoints.length === 0) {
      return `Verified against Arkansas's officially published statewide totals for all ${points.length} years ` +
        `(${confirmedRange}) — ${sourceAttribution(confirmedPoints)} — no residual in any of those years.`;
    }
    if (confirmedPoints.length === 0) {
      // Defensive, not reachable with today's data (all 13 years are
      // already confirmed) -- but if ADE_CONFIRMED_YEARS were ever
      // emptied, this avoids the same crash in the other direction.
      return `${unconfirmedRange} ${unconfirmedPoints.length === 1 ? "is" : "are"} not verified against an ` +
        `external ADE publication — ADE's archived Annual Statistical Reports likely have the figures, not yet retrieved.`;
    }
    return `Verified against Arkansas's officially published statewide totals for ${confirmedPoints.length} of ` +
      `${points.length} years (${confirmedRange}) — ${sourceAttribution(confirmedPoints)} — no residual in any of ` +
      `those years. ${unconfirmedRange} ${unconfirmedPoints.length === 1 ? "is" : "are"} not verified against an ` +
      `external ADE publication — ADE's archived Annual Statistical Reports likely have the figures, not yet retrieved.`;
  }

  if (seriesKey === "district") {
    footnote.textContent =
      `This series sums the ${last.totalN} regular public school districts tracked in this tool, including each ` +
      `predecessor entity's reported enrollment for years before its successor's current boundary took effect ` +
      `(e.g. Norphlet counts toward Smackover Norphlet before their 2014 merger). ${verificationClause()} ` +
      `See the table for the District/Charter/Other/Predecessor breakdown. See METHODOLOGY.md.`;
  } else if (seriesKey === "all") {
    footnote.textContent =
      `This is the full statewide total: public school districts, charter schools, a small number of other public ` +
      `schools (the Division of Youth Services School System and the Arkansas School for the Deaf and Blind), and, ` +
      `for years before their own merger, predecessor districts later absorbed into a current district (e.g. ` +
      `Dollarway before its 2021 merger into Pine Bluff). ${verificationClause()} ` +
      `See the table for the District/Charter/Other/Predecessor breakdown. See METHODOLOGY.md.`;
  } else {
    const reconciledClause = confirmedPoints.length === points.length
      ? `all ${points.length} years`
      : `${confirmedPoints.length} of ${points.length} years`;
    footnote.textContent =
      `This series sums every public charter school LEA reporting to SIS that year (${last.charterCount} in ${schoolYearLabel(last.year)}), ` +
      `excluding predecessor districts absorbed by a merger (tracked separately — see the table's Predecessor ` +
      `column). Growth reflects both enrollment growth at existing public charter schools and new ones opening ` +
      `— the number of reporting entities changes year to year, it isn't a fixed panel. This series isn't independently verified ` +
      `against an external ADE publication on its own; it's verified indirectly, via the zero-residual check that ` +
      `District + Charter + Other + Predecessor reconciles exactly to the ADE-confirmed All total in ` +
      `${reconciledClause}. See the table for the full breakdown. See METHODOLOGY.md.`;
  }
}

function renderTableRows(points) {
  const tbody = document.getElementById("data-table-body");
  tbody.textContent = "";
  for (const p of points) {
    const tr = document.createElement("tr");
    const cells = [
      schoolYearLabel(p.year),
      eraLabel(p.era),
      fmtInt(p.all),
      fmtInt(p.district),
      fmtInt(p.charter),
      fmtInt(p.other),
      fmtInt(p.predecessor),
    ];
    cells.forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

function initTableToggle() {
  const toggle = document.getElementById("table-toggle");
  const table = document.getElementById("data-table");
  const note = document.getElementById("table-note");
  toggle.addEventListener("click", () => {
    const open = table.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Hide table" : "View as table";
    note.hidden = !open;
  });
}

function initSeriesTabs(onChange) {
  const buttons = [...document.querySelectorAll(".series-toggle button")];
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      onChange(btn.dataset.series);
    });
  });
}

function renderChart(points, seriesKey) {
  const svg = document.getElementById("chart-svg");
  svg.textContent = "";
  const tooltip = document.getElementById("tooltip");
  tooltip.style.opacity = 0; // a stale tooltip from before a tab switch would otherwise linger
  tooltip.innerHTML = "";
  const field = SERIES[seriesKey].field;

  const minYear = points[0].year, maxYear = points[points.length - 1].year;
  const values = points.map((p) => p[field]);
  const dataMin = Math.min(...values), dataMax = Math.max(...values);
  const pad = (dataMax - dataMin) * 0.15 || dataMax * 0.05;
  const step = niceStep(dataMax + pad - (dataMin - pad), 5);
  const yMin = Math.max(0, Math.floor((dataMin - pad) / step) * step);
  const yMax = Math.ceil((dataMax + pad) / step) * step;

  const x = (year) => MARGIN.left + ((year - minYear) / (maxYear - minYear)) * PLOT_W;
  const y = (val) => MARGIN.top + PLOT_H - ((val - yMin) / (yMax - yMin)) * PLOT_H;
  const halfStep = (x(minYear + 1) - x(minYear)) / 2;

  function el(name, attrs) {
    const e = document.createElementNS(SVG_NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // --- era bands ---
  const bandRanges = [
    { era: "covid", from: COVID_YEARS[0], to: COVID_YEARS[COVID_YEARS.length - 1] },
    { era: "efa", from: EFA_START, to: maxYear },
  ];
  for (const b of bandRanges) {
    const x0 = x(b.from) - halfStep;
    const x1 = x(b.to) + halfStep;
    const cls = b.era === "covid" ? "var(--band-covid)" : "var(--band-efa)";
    svg.appendChild(el("rect", {
      x: x0, y: MARGIN.top, width: x1 - x0, height: PLOT_H,
      fill: cls,
    }));
    const label = svg.appendChild(el("text", {
      class: "band-label", x: x0 + 6, y: MARGIN.top + 14,
    }));
    label.textContent = eraLabel(b.era);
  }

  // --- gridlines + y ticks ---
  for (let v = yMin; v <= yMax + 1e-6; v += step) {
    svg.appendChild(el("line", {
      class: "gridline", x1: MARGIN.left, x2: VB_W - MARGIN.right, y1: y(v), y2: y(v),
    }));
    const t = svg.appendChild(el("text", {
      class: "axis-label", x: MARGIN.left - 8, y: y(v) + 4, "text-anchor": "end",
    }));
    t.textContent = fmtInt(v);
  }

  // --- x-axis baseline + year ticks ---
  svg.appendChild(el("line", {
    class: "baseline-rule",
    x1: MARGIN.left, x2: VB_W - MARGIN.right, y1: MARGIN.top + PLOT_H, y2: MARGIN.top + PLOT_H,
  }));
  for (const p of points) {
    const t = svg.appendChild(el("text", {
      class: "axis-label", x: x(p.year), y: MARGIN.top + PLOT_H + 18, "text-anchor": "middle",
    }));
    t.textContent = String(p.year);
  }

  // --- line ---
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.year)} ${y(p[field])}`).join(" ");
  svg.appendChild(el("path", { class: `line-mark series-${seriesKey}`, d: pathD }));

  // --- endpoint marker + direct label ---
  const last = points[points.length - 1];
  svg.appendChild(el("circle", { class: `end-dot series-${seriesKey}`, cx: x(last.year), cy: y(last[field]), r: 4 }));
  const endLabel = svg.appendChild(el("text", {
    class: "end-label", x: x(last.year), y: y(last[field]) - 12, "text-anchor": "end",
  }));
  endLabel.textContent = fmtInt(last[field]);

  // --- crosshair + hover dot ---
  const crosshair = el("line", {
    class: "crosshair", x1: 0, x2: 0, y1: MARGIN.top, y2: MARGIN.top + PLOT_H,
  });
  svg.appendChild(crosshair);
  const hoverDot = el("circle", { class: `hover-dot series-${seriesKey}`, r: 5 });
  svg.appendChild(hoverDot);

  function showTooltip(p) {
    crosshair.setAttribute("x1", x(p.year));
    crosshair.setAttribute("x2", x(p.year));
    crosshair.style.opacity = 1;
    hoverDot.setAttribute("cx", x(p.year));
    hoverDot.setAttribute("cy", y(p[field]));
    hoverDot.style.opacity = 1;

    tooltip.innerHTML = "";
    const yearEl = document.createElement("div");
    yearEl.className = "t-year";
    yearEl.textContent = schoolYearLabel(p.year);
    const valEl = document.createElement("div");
    valEl.className = "t-value";
    valEl.textContent = fmtInt(p[field]) + " students";
    const eraEl = document.createElement("div");
    eraEl.className = "t-era";
    eraEl.textContent = eraLabel(p.era);
    tooltip.appendChild(yearEl);
    tooltip.appendChild(valEl);
    tooltip.appendChild(eraEl);
    tooltip.style.opacity = 1;

    const rootRect = svg.parentElement.getBoundingClientRect();
    const px = (x(p.year) / VB_W) * rootRect.width;
    tooltip.style.left = Math.min(px + 12, rootRect.width - 170) + "px";
    tooltip.style.top = "8px";
  }

  function hideTooltip() {
    crosshair.style.opacity = 0;
    hoverDot.style.opacity = 0;
    tooltip.style.opacity = 0;
  }

  // Invisible full-height hit rect: pointer position -> nearest year
  const hitRect = el("rect", {
    x: MARGIN.left, y: MARGIN.top, width: PLOT_W, height: PLOT_H, fill: "transparent",
  });
  hitRect.addEventListener("pointermove", (evt) => {
    const rect = svg.getBoundingClientRect();
    const svgX = ((evt.clientX - rect.left) / rect.width) * VB_W;
    const yearFloat = minYear + ((svgX - MARGIN.left) / PLOT_W) * (maxYear - minYear);
    const nearest = points.reduce((a, b) =>
      Math.abs(b.year - yearFloat) < Math.abs(a.year - yearFloat) ? b : a
    );
    showTooltip(nearest);
  });
  hitRect.addEventListener("pointerleave", hideTooltip);
  svg.appendChild(hitRect);

  // Keyboard-focusable points (same info via focus as via hover)
  for (const p of points) {
    const hit = el("circle", {
      class: "hit-point", cx: x(p.year), cy: y(p[field]), r: 12, tabindex: "0",
      role: "img", "aria-label": `${schoolYearLabel(p.year)}: ${fmtInt(p[field])} students, ${eraLabel(p.era)}`,
    });
    hit.addEventListener("focus", () => showTooltip(p));
    hit.addEventListener("blur", hideTooltip);
    hit.addEventListener("pointerenter", () => showTooltip(p));
    svg.appendChild(hit);
  }
}

main();
