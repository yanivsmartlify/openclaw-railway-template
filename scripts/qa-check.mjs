#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_DAYS = 5;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_CONFIG_PATH = "/app/scripts/qa-config.json";

function parseArgs(argv) {
  const args = { days: DEFAULT_DAYS };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--sites-file") args.sitesFile = argv[++i];
    else if (token === "--sheet") args.sheet = argv[++i];
    else if (token === "--config") args.config = argv[++i];
    else if (token === "--days") args.days = Number(argv[++i]);
    else if (token === "--help" || token === "-h") args.help = true;
  }
  return args;
}

function usage() {
  console.log(`QA check for recent articles on websites.

Usage:
  node scripts/qa-check.mjs
  node scripts/qa-check.mjs --sites-file ./scripts/qa-sites.example.txt
  node scripts/qa-check.mjs --sheet "<google-sheet-url-or-csv-export-url>"

Options:
  --days <N>        Recent window in days (default: ${DEFAULT_DAYS})
  --sites-file      Text file with one URL per line
  --sheet           Google Sheet URL or CSV export URL
  --config <PATH>   Config JSON path (default: ${DEFAULT_CONFIG_PATH})
  --help            Show this help
`);
}

function normalizeUrl(raw) {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `https://${value}`;
}

function extractGoogleSheetId(url) {
  const match = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url);
  return match?.[1] || null;
}

function toGoogleCsvUrl(inputUrl) {
  try {
    const u = new URL(inputUrl);
    if (u.hostname !== "docs.google.com") return inputUrl;
    const id = extractGoogleSheetId(inputUrl);
    if (!id) return inputUrl;
    let gid = u.searchParams.get("gid");
    if (!gid && u.hash?.includes("gid=")) {
      gid = new URLSearchParams(u.hash.slice(1)).get("gid");
    }
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
  } catch {
    return inputUrl;
  }
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

async function loadSitesFromFile(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  const text = await fs.readFile(abs, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(normalizeUrl)
    .filter(Boolean);
}

async function loadSitesFromSheet(sheetUrl) {
  const csvUrl = toGoogleCsvUrl(sheetUrl);
  const response = await fetch(csvUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch sheet CSV: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const rows = lines.map(parseCsvLine);
  const headers = rows[0].map((h) => h.toLowerCase());
  const urlHeaderIdx = headers.findIndex((h) => h.includes("url") || h.includes("site") || h.includes("domain"));

  const dataRows = rows.slice(1);
  const sites = [];
  for (const row of dataRows) {
    const raw = urlHeaderIdx >= 0 ? row[urlHeaderIdx] : row[0];
    const maybeUrl = normalizeUrl(raw);
    if (maybeUrl) sites.push(maybeUrl);
  }
  return [...new Set(sites)];
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickRecent(items, cutoffDate) {
  for (const item of items) {
    if (!item.dateIso) continue;
    const date = new Date(item.dateIso);
    if (!Number.isNaN(date.getTime()) && date >= cutoffDate) {
      return item;
    }
  }
  return null;
}

async function collectArticles(page, pageUrl) {
  return page.evaluate((originUrl) => {
    const cleaned = (v) => String(v || "").replace(/\s+/g, " ").trim();
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const candidates = [];

    const articleNodes = [...document.querySelectorAll("article, main article, [role='article']")];
    for (const node of articleNodes) {
      if (!isVisible(node)) continue;
      const time = node.querySelector("time");
      const heading = node.querySelector("h1, h2, h3, h4, a");
      const dateText = cleaned(time?.getAttribute("datetime") || time?.textContent || "");
      const title = cleaned(heading?.textContent || "");
      const href = heading?.closest("a")?.href || heading?.getAttribute?.("href") || "";
      candidates.push({ title, dateText, href });
    }

    // Fallback: visible time elements with nearest heading/link
    if (candidates.length === 0) {
      const timeNodes = [...document.querySelectorAll("time")];
      for (const timeNode of timeNodes) {
        if (!isVisible(timeNode)) continue;
        const container = timeNode.closest("article, li, div, section") || timeNode.parentElement;
        const heading = container?.querySelector("h1, h2, h3, h4, a");
        const dateText = cleaned(timeNode.getAttribute("datetime") || timeNode.textContent || "");
        const title = cleaned(heading?.textContent || "");
        const href = heading?.closest("a")?.href || heading?.getAttribute?.("href") || "";
        candidates.push({ title, dateText, href });
      }
    }

    // Obvious home link that may contain recent articles.
    let obviousSectionLink = "";
    const links = [...document.querySelectorAll("a[href]")];
    for (const link of links) {
      const text = cleaned(link.textContent).toLowerCase();
      if (!text) continue;
      if (/(news|blog|latest|articles|insights)/.test(text)) {
        const href = link.href || "";
        if (href && href.startsWith(originUrl)) {
          obviousSectionLink = href;
          break;
        }
      }
    }

    return { candidates, obviousSectionLink };
  }, new URL(pageUrl).origin);
}

function parseCandidateDate(rawDateText) {
  const dateText = sanitizeText(rawDateText);
  if (!dateText) return null;
  const parsed = new Date(dateText);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  const m = dateText.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) {
    const iso = `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

async function checkSite(browser, siteUrl, cutoffDate, daysWindow) {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (compatible; QAArticleChecker/1.0)",
  });
  const page = await context.newPage();
  try {
    await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    let { candidates, obviousSectionLink } = await collectArticles(page, siteUrl);

    if (candidates.length === 0 && obviousSectionLink) {
      await page.goto(obviousSectionLink, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
      ({ candidates } = await collectArticles(page, obviousSectionLink));
    }

    const normalized = candidates.map((item) => ({
      title: sanitizeText(item.title) || "(untitled)",
      href: sanitizeText(item.href),
      dateText: sanitizeText(item.dateText),
      dateIso: parseCandidateDate(item.dateText),
    }));

    const recent = pickRecent(normalized, cutoffDate);
    if (recent) {
      await context.close();
      return {
        site: siteUrl,
        status: "PASSED",
        evidence: `${recent.title} | ${recent.dateText || recent.dateIso}`,
        reason: `Found article within last ${daysWindow} days`,
      };
    }

    if (normalized.length === 0) {
      await context.close();
      return {
        site: siteUrl,
        status: "FAILED",
        evidence: "No visible article/time blocks found",
        reason: "Homepage has no identifiable recent article metadata",
      };
    }

    const newestKnown = normalized.find((x) => x.dateIso);
    await context.close();
    return {
      site: siteUrl,
      status: "FAILED",
      evidence: newestKnown ? `${newestKnown.title} | ${newestKnown.dateText}` : "Articles found, but no parseable dates",
      reason: newestKnown
        ? `Latest parseable date is older than ${daysWindow} days`
        : "Could not parse publication dates from visible articles",
    };
  } catch (err) {
    await context.close();
    return {
      site: siteUrl,
      status: "FAILED",
      evidence: "site unreachable",
      reason: String(err.message || err),
    };
  }
}

function renderTable(results) {
  const headers = ["Site", "Status", "Evidence", "Reason"];
  const rows = results.map((r) => [r.site, r.status, r.evidence, r.reason]);
  const all = [headers, ...rows];

  const widths = headers.map((_, colIdx) =>
    Math.max(...all.map((row) => String(row[colIdx]).length), headers[colIdx].length),
  );

  const line = (row) =>
    row
      .map((cell, i) => String(cell).padEnd(widths[i], " "))
      .join(" | ");

  const sep = widths.map((w) => "-".repeat(w)).join("-|-");
  console.log(line(headers));
  console.log(sep);
  for (const row of rows) console.log(line(row));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!Number.isFinite(args.days) || args.days < 1) {
    throw new Error("--days must be a positive number");
  }

  const cutoffDate = new Date();
  cutoffDate.setHours(0, 0, 0, 0);
  cutoffDate.setDate(cutoffDate.getDate() - args.days);

  const configPath = args.config || process.env.QA_CONFIG_PATH || DEFAULT_CONFIG_PATH;
  let config = {};
  try {
    const raw = await fs.readFile(configPath, "utf8");
    config = JSON.parse(raw);
  } catch {
    // Config is optional; CLI args/env can fully define behavior.
  }

  const sheetUrl = args.sheet || process.env.QA_SHEET_URL || config.defaultSheetUrl;
  const sitesFile = args.sitesFile || process.env.QA_SITES_FILE || config.defaultSitesFile;

  if (!sheetUrl && !sitesFile) {
    usage();
    throw new Error(
      "No input source configured. Pass --sheet/--sites-file or set QA_SHEET_URL or scripts/qa-config.json",
    );
  }

  const sites = sitesFile
    ? await loadSitesFromFile(sitesFile)
    : await loadSitesFromSheet(sheetUrl);

  if (sites.length === 0) {
    throw new Error("No sites found. Check input file/sheet.");
  }

  console.log(`Checking ${sites.length} sites. Cutoff date: ${formatDate(cutoffDate)}`);
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("playwright package is not available. Install dependencies in runtime image.");
  }
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const site of sites) {
    process.stdout.write(`- ${site}\n`);
    // eslint-disable-next-line no-await-in-loop
    const result = await checkSite(browser, site, cutoffDate, args.days);
    results.push(result);
  }
  await browser.close();

  console.log("");
  renderTable(results);
  const passed = results.filter((r) => r.status === "PASSED").length;
  const failed = results.length - passed;
  console.log("");
  console.log(`Totals: PASSED=${passed}, FAILED=${failed}, ALL=${results.length}`);

  if (failed > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(`ERROR: ${err.message || err}`);
  process.exit(1);
});
