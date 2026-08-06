#!/usr/bin/env python3
"""
Normalise Shopee 'Laporan Iklan CPC' exports (CSV or XLSX) into flat rows
ready for NocoBase.

Handles:
  - multiple period blocks stacked in one file
  - weekly and monthly granularity (auto-detected from period length)
  - quoted commas in ad names
  - percent strings, thousand separators, '-' nulls
  - xlsx workbooks with many sheets: reads the "ALL" tab specifically
    (falls back to scanning for a sheet with Urutan/Periode headers if
    no sheet is literally named "ALL")

Schema note (2026-07): `family` no longer lives on shopee_ads_performance.
It only lives on shopee_product_map. This script still *derives* a family
guess per ad (heuristic, same as before) but writes it only into the
product-map seed file, not into the performance rows.

Outputs two files from one run:
  <out>.csv / <out>.jsonl              -> shopee_ads_performance rows
  <out>_map_seed.csv                   -> shopee_product_map candidate rows
                                           (product_code, brand, ad_name,
                                           family - one row per unique
                                           product_code+brand seen).
                                           Import with nocobase_import.py
                                           --map; existing product_codes are
                                           left untouched (insert-only).

Usage:
    python3 parse_shopee_ads.py out.csv in1.xlsx in2.xlsx ...
    python3 parse_shopee_ads.py out.csv some_folder/*.xlsx
"""
import csv, io, re, sys, json
from datetime import datetime

COLS = {
    "Nama Iklan": "ad_name",
    "Status": "status",
    "Jenis Iklan": "ad_type",
    "Kode Produk": "product_code",
    "Mode Bidding": "bidding_mode",
    "Penempatan Iklan": "placement",
    "Tanggal Mulai": "ad_started_at",
    "Dilihat": "impressions",
    "Jumlah Klik": "clicks",
    "Persentase Klik": "ctr",
    "Konversi": "conversions",
    "Konversi Langsung": "direct_conversions",
    "Tingkat konversi": "cvr",
    "Tingkat Konversi Langsung": "direct_cvr",
    "Biaya per Konversi": "cost_per_conversion",
    "Produk Terjual": "units_sold",
    "Terjual Langsung": "direct_units_sold",
    "Omzet Penjualan": "gmv",
    "Penjualan Langsung (GMV Langsung)": "direct_gmv",
    "Biaya": "spend",
    "Efektifitas Iklan": "roas",
    "Efektivitas Langsung": "direct_roas",
}
NUMERIC = {"impressions", "clicks", "conversions", "direct_conversions",
           "units_sold", "direct_units_sold", "gmv", "direct_gmv", "spend",
           "roas", "direct_roas", "cost_per_conversion"}
PERCENT = {"ctr", "cvr", "direct_cvr"}

# Fields that belong on shopee_ads_performance (order = column order in CSV).
# NOTE: no "family" here - it moved to shopee_product_map only.
PERF_FIELD_ORDER = [
    "brand", "granularity", "period_start", "period_end", "days_in_period",
    "product_code", "ad_name", "status", "ad_type", "bidding_mode",
    "placement", "is_shop_level", "impressions", "clicks", "ctr",
    "conversions", "direct_conversions", "cvr", "direct_cvr", "units_sold",
    "direct_units_sold", "gmv", "direct_gmv", "spend", "roas", "direct_roas",
    "cpc", "aov", "cost_per_conversion", "spend_per_day", "units_per_day",
    "ad_started_at",
]


def num(v):
    if v is None:
        return None
    s = str(v).strip().replace("\u00a0", "")
    if s in ("", "-", "nan", "None"):
        return None
    s = s.replace("%", "")
    # Indonesian/EU-style CSV text exports sometimes write '.' as a
    # thousands separator and ',' as the decimal point (e.g. "1.234,56").
    # Only attempt that reinterpretation when a comma is actually present -
    # otherwise a plain xlsx-sourced decimal like "0.027" (1-3 digits, dot,
    # exactly 3 digits) also matches the old blanket regex and gets
    # misread as "0027" -> 27.0, a 1000x inflation bug confirmed in the
    # real data (CTR values up to 900 instead of <=1). A bare '.' from an
    # xlsx cell (via pandas dtype=str) is always a genuine decimal point,
    # never thousands grouping, so no comma => no reinterpretation.
    if "," in s:
        if re.fullmatch(r"-?\d{1,3}(\.\d{3})*,\d+", s):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def parse_dmy_datetime(v):
    if not v:
        return None
    t = str(v).strip()
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", t)          # 08/03/2026  (CSV export)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", t)          # 2024-10-31  (xlsx export)
    if m:
        return m.group(0)
    return None


def parse_period(s):
    m = re.search(r"(\d{2}/\d{2}/\d{4})\s*-\s*(\d{2}/\d{2}/\d{4})", str(s))
    if not m:
        return None, None
    f = "%d/%m/%Y"
    return (datetime.strptime(m.group(1), f).date(),
            datetime.strptime(m.group(2), f).date())


def _norm_label(s):
    """Older exports (2023 / early 2024) write labels with a trailing colon
    ("Periode:", "Username:") instead of bare ("Periode", "Username").
    Normalize so both styles compare equal."""
    return str(s).strip().rstrip(":").strip()


def _looks_like_report_sheet(df):
    col0 = [_norm_label(v) for v in df[0].astype(str).tolist()]
    return "Urutan" in col0 and "Periode" in col0


def load_rows(path):
    if path.lower().endswith((".xlsx", ".xls")):
        import pandas as pd
        xl = pd.ExcelFile(path)
        # 1) Prefer a sheet literally named "ALL" (this is what the report
        #    is meant to be read from in current-format exports).
        for sheet in xl.sheet_names:
            if sheet.strip().upper() == "ALL":
                df = pd.read_excel(xl, sheet_name=sheet, header=None, dtype=str)
                if not df.empty and _looks_like_report_sheet(df):
                    print(f"    using sheet '{sheet}' (exact match)")
                    return df.fillna("").values.tolist()
        # 1b) 2023-era exports call the same tab "OVERALL" instead of "ALL".
        for sheet in xl.sheet_names:
            if sheet.strip().upper() == "OVERALL":
                df = pd.read_excel(xl, sheet_name=sheet, header=None, dtype=str)
                if not df.empty and _looks_like_report_sheet(df):
                    print(f"    using sheet '{sheet}' (exact match, legacy name)")
                    return df.fillna("").values.tolist()
        # 2) Fall back to scanning every sheet for the Urutan/Periode header
        #    pattern, in case a workbook is missing an "ALL"/"OVERALL" tab or
        #    it was renamed to something else entirely.
        for sheet in xl.sheet_names:
            df = pd.read_excel(xl, sheet_name=sheet, header=None, dtype=str)
            if df.empty:
                continue
            if _looks_like_report_sheet(df):
                print(f"    using sheet '{sheet}' (fallback scan, no ALL/OVERALL tab found)")
                return df.fillna("").values.tolist()
        raise SystemExit(f"No Shopee CPC report sheet found in {path}")
    with io.open(path, encoding="utf-8-sig", newline="") as fh:
        return list(csv.reader(fh))


def detect_brand(rows):
    """Read Username / Nama Toko from the export header."""
    user = shop = shop_id = None
    for r in rows[:12]:
        if not r:
            continue
        k = _norm_label(r[0]).lower()
        v = str(r[1]).strip() if len(r) > 1 else ""
        if k == "username" and v:
            user = v
        elif k == "nama toko" and v:
            shop = v
        elif k == "id toko" and v:
            shop_id = v.split(".")[0]
    brand = re.sub(r"[^a-z0-9]+", "_", (user or shop or "unknown").lower()).strip("_")
    return brand, shop, shop_id


def parse_file(path, brand_override=None):
    rows = load_rows(path)
    brand, shop_name, shop_id = detect_brand(rows)
    if brand_override:
        brand = brand_override
    print(f"    brand='{brand}'  shop='{shop_name}'  id={shop_id}")
    out, period, header = [], (None, None), None
    for r in rows:
        r = [str(c) if c is not None else "" for c in r]
        if not r or all(not c.strip() for c in r):
            continue
        c0 = _norm_label(r[0])
        if c0 == "Periode":
            period = parse_period(",".join(r[1:]))
            header = None
            continue
        if c0 == "Urutan":
            header = [h.strip() for h in r]
            continue
        if header is None or not c0.isdigit():
            continue

        raw = dict(zip(header, r))
        rec = {}
        for src, dst in COLS.items():
            v = raw.get(src, "")
            if dst in NUMERIC:
                rec[dst] = num(v)
            elif dst in PERCENT:
                x = num(v)
                # xlsx exports store percent cells as an already-divided
                # fraction (e.g. 0.0499, cell format "0.00%") with no '%'
                # character in the value. CSV exports write literal
                # "4.99%" text. Only divide by 100 when the source text
                # actually contained a '%' sign - otherwise it's already
                # a fraction and dividing again would be a 100x error.
                if x is not None and "%" in str(v):
                    x = x / 100
                rec[dst] = x
            else:
                rec[dst] = str(v).strip() or None

        ps, pe = period
        if not ps:
            continue
        days = (pe - ps).days + 1
        rec["period_start"] = ps.isoformat()
        rec["period_end"] = pe.isoformat()
        rec["granularity"] = "weekly" if days <= 10 else (
            "monthly" if days <= 40 else "custom")
        rec["days_in_period"] = days

        code = (rec.get("product_code") or "0").strip()
        # Guard against source-file corruption: a small number of rows in
        # the raw Shopee export have the ad name accidentally split across
        # two cells (an extra cell inserted after "Nama Iklan"), which
        # shifts every subsequent column one to the right - Status ends up
        # in the product_code slot, impressions end up in the ctr slot,
        # etc. Confirmed in 20230814 KANO Ads SHOPEE.xlsx (product
        # 10583260481, "Kano -Creek..."). A real Shopee product_code is
        # always all-digit (or "0"/blank for shop-level rows) - anything
        # else means the row is misaligned. Reject rather than guess a
        # realignment, since this is rare (2 rows found across 340 files).
        if code not in ("0", "", "None") and not code.isdigit():
            print(f"    SKIPPED corrupted row (product_code='{code}', "
                  f"likely column-shift from a split ad-name cell): "
                  f"{rec.get('ad_name')!r}")
            continue
        rec["product_code"] = code
        rec["is_shop_level"] = code in ("0", "", "None")

        # derived
        sp, cl, u, g = (rec.get("spend"), rec.get("clicks"),
                        rec.get("units_sold"), rec.get("gmv"))
        rec["cpc"] = round(sp / cl, 2) if sp and cl else None
        rec["aov"] = round(g / u, 2) if g and u else None
        rec["spend_per_day"] = round(sp / days, 2) if sp else None
        rec["units_per_day"] = round(u / days, 3) if u else None
        # recompute roas so it is never blank when both sides exist
        if rec.get("roas") is None and sp and g:
            rec["roas"] = round(g / sp, 2)

        rec["brand"] = brand
        # family is only computed for the product-map seed (see below),
        # not stored on the performance row anymore.
        rec["_family_guess"] = family_of(rec["ad_name"], brand)
        # ad start date: "08/03/2026 00:00:00" -> ISO
        st = parse_dmy_datetime(rec.get("ad_started_at"))
        rec["ad_started_at"] = st
        out.append(rec)
    return out


STOP = {"inkano", "dress", "outer", "outerwear", "atasan", "kemeja", "rok",
        "celana", "pants", "cardigan", "cardie", "knit", "sleeveless",
        "wanita", "korea", "katun", "dengan", "details", "warna", "dan",
        "the", "skirt", "top", "maxi", "midi", "jacket", "basic", "tee",
        "ootd", "flatlay", "compare", "color", "cat", "line", "sol"}


BRAND_WORDS = ["inkano", "aska ?label", "askalabel", "aska"]


def family_of(name, brand=None):
    """Heuristic first-pass family guess. Override in shopee_product_map."""
    if not name:
        return None
    n = name
    # 'X by Aska Label - ...' -> 'X - ...'
    n = re.sub(r"\s+by\s+(" + "|".join(BRAND_WORDS) + r")\b", "", n, flags=re.I)
    for b in BRAND_WORDS + ([brand] if brand else []):
        n = re.sub(r"^\s*" + b + r"\s*[-–—:]?\s*", "", n, flags=re.I)
    segs = [s for s in re.split(r"[-–—\[(]", n) if s.strip()]
    for seg in segs[:2]:
        toks = [t for t in re.findall(r"[A-Za-z]+", seg)
                if t.lower() not in STOP and len(t) > 2]
        if toks:
            return toks[0].lower()
    return None


def write_perf(out_path, dedup):
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=PERF_FIELD_ORDER)
        w.writeheader()
        for r in dedup:
            w.writerow({k: r.get(k) for k in PERF_FIELD_ORDER})
    with open(out_path.replace(".csv", ".jsonl"), "w", encoding="utf-8") as fh:
        for r in dedup:
            fh.write(json.dumps({k: r.get(k) for k in PERF_FIELD_ORDER},
                                 ensure_ascii=False) + "\n")


def write_map_seed(out_path, dedup):
    """One row per unique (brand, product_code) seen, excluding shop-level
    rows (product_code '0'). This is a *candidate* list for
    shopee_product_map - nocobase_import.py --map only INSERTS codes that
    don't already exist there, so re-running this is always safe."""
    seen = {}
    for r in dedup:
        if r.get("is_shop_level"):
            continue
        code = r.get("product_code")
        if not code or code == "0":
            continue
        key = (r["brand"], code)
        if key not in seen:
            seen[key] = {
                "product_code": code,
                "brand": r["brand"],
                "ad_name": r.get("ad_name"),
                "family": r.get("_family_guess"),
            }
    seed_path = out_path.replace(".csv", "_map_seed.csv")
    fields = ["product_code", "brand", "ad_name", "family"]
    with open(seed_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for row in seen.values():
            w.writerow(row)
    return seed_path, len(seen)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    args = sys.argv[1:]
    brand_override = None
    if "--brand" in args:
        i = args.index("--brand")
        brand_override = args[i + 1]
        del args[i:i + 2]
    out_path, inputs = args[0], args[1:]
    recs = []
    for p in inputs:
        print(f"  {p.rsplit('/',1)[-1]}:")
        got = parse_file(p, brand_override)
        print(f"    {len(got)} rows")
        recs += got

    if not recs:
        sys.exit("No rows parsed from any input file.")

    seen, dedup = set(), []
    for r in recs:
        sig = json.dumps({k: r.get(k) for k in PERF_FIELD_ORDER},
                          sort_keys=True, default=str)
        if sig in seen:
            continue
        seen.add(sig)
        dedup.append(r)

    groups = {}
    for r in dedup:
        groups[(r["brand"], r["granularity"], r["period_start"])] = 1
    print(f"  {len(groups)} brand/period group(s)")
    for k in sorted(groups):
        print(f"    {k[0]:12s} {k[1]:8s} {k[2]}")

    write_perf(out_path, dedup)
    seed_path, n_seed = write_map_seed(out_path, dedup)
    print(f"\n{len(dedup)} unique performance rows -> {out_path}")
    print(f"{n_seed} unique product codes -> {seed_path}  "
          f"(import with: nocobase_import.py --map {seed_path})")


if __name__ == "__main__":
    main()
