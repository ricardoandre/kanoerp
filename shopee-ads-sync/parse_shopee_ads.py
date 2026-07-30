#!/usr/bin/env python3
"""
Normalise Shopee 'Laporan Iklan CPC' exports (CSV or XLSX) into flat rows
ready for NocoBase.

Handles:
  - multiple period blocks stacked in one file
  - weekly and monthly granularity (auto-detected from period length)
  - quoted commas in ad names
  - percent strings, thousand separators, '-' nulls

Usage:
    python3 parse_shopee_ads.py out.csv in1.csv in2.csv ...
"""
import csv, io, re, sys, json, hashlib
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


def num(v):
    if v is None:
        return None
    s = str(v).strip().replace("\u00a0", "")
    if s in ("", "-", "nan", "None"):
        return None
    s = s.replace("%", "")
    # Indonesian exports sometimes use '.' as thousands sep and ',' as decimal
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", s):
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


def load_rows(path):
    if path.lower().endswith((".xlsx", ".xls")):
        import pandas as pd
        xl = pd.ExcelFile(path)
        for sheet in xl.sheet_names:
            df = pd.read_excel(xl, sheet_name=sheet, header=None, dtype=str)
            if df.empty:
                continue
            col0 = df[0].astype(str).tolist()
            if "Urutan" in col0 and "Periode" in col0:
                print(f"    using sheet '{sheet}'")
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
        k = str(r[0]).strip().lower()
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
        c0 = r[0].strip()
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
                rec[dst] = x / 100 if x is not None else None
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
        rec["family"] = family_of(rec["ad_name"], brand)
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

    seen, dedup = set(), []
    for r in recs:
        sig = json.dumps(r, sort_keys=True, default=str)
        if sig in seen:
            continue
        seen.add(sig)
        dedup.append(r)
    groups = {}
    for r in dedup:
        groups[(r["brand"], r["granularity"], r["period_start"])] = 1
    print(f"  {len(groups)} brand/period group(s)")

    fields = list(dedup[0].keys())
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(dedup)
    with open(out_path.replace(".csv", ".jsonl"), "w", encoding="utf-8") as fh:
        for r in dedup:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"\n{len(dedup)} unique rows -> {out_path}")


if __name__ == "__main__":
    main()
