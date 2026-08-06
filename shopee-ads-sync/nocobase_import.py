#!/usr/bin/env python3
"""
Create the Shopee ads collections in NocoBase and upsert parsed rows.

    export NB_URL="https://erp.example.com"
    export NB_TOKEN="<admin API token>"

    python3 nocobase_import.py --schema                       # create collections
    python3 nocobase_import.py --data shopee_ads_normalized.csv
    python3 nocobase_import.py --map  shopee_ads_normalized_map_seed.csv

Re-running --data is safe: for each (brand, granularity, period_start) in
the file, existing rows for that group are deleted and replaced.

Re-running --map is safe: it only INSERTS product_codes that are not
already present in shopee_product_map. It never updates or overwrites an
existing row, so curated fields (tier, colorway, notes, target_roas,
margin, ...) on your existing 633 product_map rows are never touched.

2026-07 schema update:
  - `family` removed from shopee_ads_performance (it now lives only on
    shopee_product_map, joined via product_code).
  - `target_roas` / `margin` added to shopee_product_map.
  - new `shopee_ads_action_log` collection (decision log). This script can
    create the collection (--schema), but does not sync data into it -
    that table is populated by users/other tooling, not from weekly
    Excel exports.
"""
import os, sys, csv, json, time, re, argparse
import urllib.request, urllib.error

def load_env(path=".env"):
    """Minimal .env reader - no external dependency."""
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        # drop inline comments (whitespace followed by # or //)
        v = re.split(r"\s+(?:#|//)", v, maxsplit=1)[0]
        v = v.strip().strip('"').strip("'").strip()
        os.environ.setdefault(k.strip(), v)


load_env()


def _env(*names, default=""):
    for n in names:
        v = os.environ.get(n)
        if v:
            return v.strip()
    return default


# Accepts NOCOBASE_URL / NOCOBASE_API_KEY or the shorter NB_* names
NB_URL = _env("NOCOBASE_URL", "NB_URL").rstrip("/")
if NB_URL.endswith("/api"):
    NB_URL = NB_URL[:-4]
NB_TOKEN = _env("NOCOBASE_API_KEY", "NOCOBASE_TOKEN", "NB_TOKEN")
NB_ROLE = _env("NOCOBASE_ROLE")

PERF = "shopee_ads_performance"
MAP = "shopee_product_map"
ACTION = "shopee_ads_action_log"


def F(name, type_, ui="input", **kw):
    d = {"name": name, "type": type_, "interface": ui}
    d.update(kw)
    return d


# NOTE: no "family" field here anymore - it moved to shopee_product_map.
PERF_FIELDS = [
    F("brand", "string"),
    F("granularity", "string"),
    F("period_start", "date", "datePicker"),
    F("period_end", "date", "datePicker"),
    F("days_in_period", "integer", "integer"),
    F("product_code", "string"),
    F("ad_name", "text", "textarea"),
    F("status", "string"),
    F("ad_type", "string"),
    F("bidding_mode", "string"),
    F("placement", "string"),
    F("is_shop_level", "boolean", "checkbox"),
    F("impressions", "bigInt", "integer"),
    F("clicks", "bigInt", "integer"),
    F("ctr", "double", "percent"),
    F("conversions", "integer", "integer"),
    F("direct_conversions", "integer", "integer"),
    F("cvr", "double", "percent"),
    F("direct_cvr", "double", "percent"),
    F("units_sold", "integer", "integer"),
    F("direct_units_sold", "integer", "integer"),
    F("gmv", "double", "number"),
    F("direct_gmv", "double", "number"),
    F("spend", "double", "number"),
    F("roas", "double", "number"),
    F("direct_roas", "double", "number"),
    F("cpc", "double", "number"),
    F("aov", "double", "number"),
    F("cost_per_conversion", "double", "number"),
    F("spend_per_day", "double", "number"),
    F("units_per_day", "double", "number"),
    F("ad_started_at", "date", "datePicker"),
]

MAP_FIELDS = [
    F("product_code", "string", unique=True),
    F("brand", "string"),
    F("ad_name", "text", "textarea"),
    F("family", "string"),
    F("colorway", "string"),
    F("tier", "string", "select", uiSchema={
        "type": "string", "title": "Tier",
        "x-component": "Select",
        "enum": [{"value": v, "label": v} for v in
                 ["hero", "profit", "test", "tail", "clearance"]]}),
    F("is_primary_listing", "boolean", "checkbox"),
    F("restockable", "boolean", "checkbox"),
    F("notes", "text", "textarea"),
    F("target_roas", "double", "number"),
    F("margin", "double", "number"),
]

# Decision log. `decided_by` is a belongsTo relation to users
# (fk_decided_by_id) - created here but not populated by this script.
ACTION_FIELDS = [
    F("id", "snowflakeId", "snowflakeId", primaryKey=True),
    F("fk_decided_by_id", "bigInt", "integer"),
    F("brand", "string"),
    F("scope", "string"),
    F("family", "string"),
    F("product_code", "string"),
    F("label", "string"),
    F("action_type", "string"),
    F("from_value", "string"),
    F("to_value", "string"),
    F("note", "text", "textarea"),
    F("expected_outcome", "text", "textarea"),
    F("review_by", "dateOnly", "date"),
    F("decided_on", "dateOnly", "date"),
    F("period_ref", "string"),
    F("snapshot", "text", "textarea"),
    F("decided_by", "belongsTo", "obo", target="users",
      foreignKey="fk_decided_by_id"),
]

NUM = {"impressions", "clicks", "conversions", "direct_conversions",
       "units_sold", "direct_units_sold", "gmv", "direct_gmv", "spend",
       "roas", "direct_roas", "cpc", "aov", "cost_per_conversion",
       "spend_per_day", "units_per_day", "ctr", "cvr", "direct_cvr",
       "days_in_period", "target_roas", "margin", "fk_decided_by_id"}
BOOL = {"is_shop_level", "is_primary_listing", "restockable"}


def call(path, payload=None, method=None):
    url = f"{NB_URL}/api/{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"))
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {NB_TOKEN}")
    if NB_ROLE:
        req.add_header("X-Role", NB_ROLE)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:400]
        raise SystemExit(f"HTTP {e.code} on {path}\n{body}")


def create_collection(name, title, fields):
    """Create collection if absent, then ensure every field exists."""
    try:
        call("collections:create", {"name": name, "title": title})
        print(f"  collection {name}: created")
    except SystemExit as e:
        msg = str(e).lower()
        if "unique" in msg or "exist" in msg or "duplicate" in msg:
            print(f"  collection {name}: already exists")
        else:
            raise

    have = set(list_fields(name))
    added, failed = [], []
    for f in fields:
        if f["name"] in have:
            continue
        try:
            call(f"collections/{name}/fields:create", f)
            added.append(f["name"])
        except SystemExit as e:
            failed.append((f["name"], str(e).splitlines()[-1][:120]))
    print(f"    fields: {len(have)} existing, {len(added)} added, {len(failed)} failed")
    for n, err in failed:
        print(f"      FAILED {n}: {err}")
    return failed


def list_fields(name):
    try:
        r = call(f"collections/{name}/fields:list?pageSize=200")
        return [f["name"] for f in r.get("data", [])]
    except SystemExit:
        return []


def inspect():
    for coll, spec in ((PERF, PERF_FIELDS), (MAP, MAP_FIELDS), (ACTION, ACTION_FIELDS)):
        have = set(list_fields(coll))
        want = {f["name"] for f in spec}
        print(f"\n{coll}")
        print(f"  fields present : {len(have)}")
        missing = sorted(want - have)
        print(f"  MISSING ({len(missing)}): {', '.join(missing) if missing else 'none'}")


def coerce(row):
    out = {}
    for k, v in row.items():
        if v in ("", None, "nan"):
            out[k] = None
        elif k in BOOL:
            out[k] = str(v).strip().lower() in ("true", "1", "yes")
        elif k in NUM:
            try:
                out[k] = float(v)
            except ValueError:
                out[k] = None
        else:
            out[k] = v
    return out


def qfilter(key, value):
    import urllib.parse
    return urllib.parse.quote(json.dumps({key: {"$eq": value}}))


def find_one(collection, key, value):
    r = call(f"{collection}:list?filter={qfilter(key, value)}&pageSize=1")
    d = r.get("data", [])
    return d[0] if d else None


def purge(collection, yes=False):
    if not yes:
        sys.exit(f"Refusing to purge {collection} without --yes")
    total = 0
    while True:
        r = call(f"{collection}:list?pageSize=200&fields=id")
        ids = [x["id"] for x in r.get("data", [])]
        if not ids:
            break
        for tk in ids:
            call(f"{collection}:destroy?filterByTk={tk}", {})
        total += len(ids)
        print(f"  deleted {total}", flush=True)
    print(f"  purged {collection}: {total} rows")


OBSOLETE = ["dedup_key", "shop_name", "shop_id", "source_file"]
# family used to live on PERF; drop it there if an older run created it.
PERF_OBSOLETE = OBSOLETE + ["family"]


def drop_fields(collection, names, yes=False):
    if not yes:
        sys.exit("Refusing to drop fields without --yes")
    have = set(list_fields(collection))
    for n in names:
        if n not in have:
            print(f"  {collection}.{n}: not present")
            continue
        try:
            call(f"collections/{collection}/fields:destroy?filterByTk={n}", {})
            print(f"  {collection}.{n}: dropped")
        except SystemExit as e:
            print(f"  {collection}.{n}: FAILED {str(e).splitlines()[-1][:100]}")


def delete_period(collection, brand, gran, period_start):
    """Remove every row for one brand/granularity/period."""
    flt = {"brand": {"$eq": brand}, "granularity": {"$eq": gran},
           "period_start": {"$eq": period_start}}
    import urllib.parse
    q = urllib.parse.quote(json.dumps(flt))
    n = 0
    while True:
        r = call(f"{collection}:list?filter={q}&fields=id&pageSize=200")
        ids = [x["id"] for x in r.get("data", [])]
        if not ids:
            return n
        for tk in ids:
            call(f"{collection}:destroy?filterByTk={tk}", {})
        n += len(ids)


def load_periods(path):
    """Period-replace: for each brand/granularity/period, delete then insert."""
    with open(path, encoding="utf-8-sig", newline="") as fh:
        rows = [coerce(r) for r in csv.DictReader(fh)]
    allowed = {f["name"] for f in PERF_FIELDS}
    rows = [{k: v for k, v in r.items() if k in allowed} for r in rows]

    groups = {}
    for r in rows:
        groups.setdefault((r["brand"], r["granularity"], r["period_start"]), []).append(r)

    print(f"  {len(rows)} rows across {len(groups)} brand/period group(s)")
    t0, done, removed = time.time(), 0, 0
    for (brand, gran, ps), batch in sorted(groups.items()):
        gone = delete_period(PERF, brand, gran, ps)
        removed += gone
        for r in batch:
            call(f"{PERF}:create", r)
        done += len(batch)
        print(f"  {brand} {gran} {ps}: -{gone} +{len(batch)}   "
              f"[{done}/{len(rows)}  {time.time()-t0:.0f}s]", flush=True)
    print(f"  done: {removed} replaced, {done} inserted")


def probe(collection, key, sample):
    """Test each CRUD operation separately so we know exactly what breaks."""
    print(f"\nprobing {collection}")
    tk = None

    def step(label, fn):
        try:
            out = fn()
            print(f"  OK    {label}")
            return out
        except SystemExit as e:
            print(f"  FAIL  {label}: {str(e).splitlines()[-1][:140]}")
            return None

    step("list", lambda: call(f"{collection}:list?pageSize=1"))
    created = step("create", lambda: call(f"{collection}:create", sample))
    if created:
        tk = created.get("data", {}).get("id")
    step("filtered list", lambda: call(
        f"{collection}:list?filter={qfilter(key, sample[key])}&pageSize=1"))
    if tk:
        step("update", lambda: call(f"{collection}:update?filterByTk={tk}", sample))
    step("updateOrCreate", lambda: call(
        f"{collection}:updateOrCreate?filterKeys={key}", sample))
    if tk:
        step("destroy (cleanup)", lambda: call(
            f"{collection}:destroy?filterByTk={tk}", {}, method="POST"))
    print("  -> if 'create' and 'filtered list' pass, use --mode safe")


def upsert(collection, path, key, batch=200, mode="safe", insert_only=False):
    """insert_only=True: never update an existing row, only create rows
    for keys not already present. Used for shopee_product_map so curated
    fields (tier, notes, target_roas, margin, ...) are never clobbered by
    an auto-generated seed file that only knows product_code/brand/
    ad_name/family."""
    with open(path, encoding="utf-8-sig", newline="") as fh:
        rows = [coerce(r) for r in csv.DictReader(fh)]
    allowed = {f["name"] for f in (PERF_FIELDS if collection == PERF else MAP_FIELDS)}
    rows = [{k: v for k, v in r.items() if k in allowed} for r in rows]
    n, made, upd, skipped, t0 = 0, 0, 0, 0, time.time()
    for r in rows:
        if insert_only:
            ex = find_one(collection, key, r[key])
            if ex:
                skipped += 1
            else:
                call(f"{collection}:create", r)
                made += 1
        elif mode == "fast":
            call(f"{collection}:updateOrCreate?filterKeys={key}", r)
        else:
            ex = find_one(collection, key, r[key])
            if ex:
                call(f"{collection}:update?filterByTk={ex['id']}", r)
                upd += 1
            else:
                call(f"{collection}:create", r)
                made += 1
        n += 1
        if n % batch == 0 or n == len(rows):
            msg = f"  {n}/{len(rows)}  created={made}"
            msg += f" skipped(existing)={skipped}" if insert_only else f" updated={upd}"
            print(f"{msg}  ({time.time()-t0:.0f}s)", flush=True)
    print(f"  done: {n} rows")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true", help="verify URL + token only")
    ap.add_argument("--inspect", action="store_true", help="list fields actually present")
    ap.add_argument("--probe", action="store_true", help="test each CRUD op separately")
    ap.add_argument("--purge", choices=["perf", "map", "action", "all"], help="DELETE all rows")
    ap.add_argument("--drop-obsolete", action="store_true",
                    help="remove dedup_key / shop_name / shop_id / source_file "
                         "(+ legacy 'family' on performance) fields")
    ap.add_argument("--yes", action="store_true", help="confirm destructive action")
    ap.add_argument("--mode", default="safe", choices=["safe", "fast"],
                    help="safe = filter+create/update (works everywhere); fast = updateOrCreate "
                         "(ignored for --map, which is always insert-only)")
    ap.add_argument("--schema", action="store_true")
    ap.add_argument("--data")
    ap.add_argument("--map")
    a = ap.parse_args()
    if not NB_URL or not NB_TOKEN:
        sys.exit("Missing NOCOBASE_URL or NOCOBASE_API_KEY (checked .env and environment).")
    print(f"NocoBase: {NB_URL}  token: ...{NB_TOKEN[-6:]}")
    if a.test:
        r = call("collections:list?pageSize=200")
        names = sorted(c["name"] for c in r.get("data", []))
        print(f"  auth OK - {len(names)} collections visible")
        for n in (PERF, MAP, ACTION):
            print(f"  {n}: {'EXISTS' if n in names else 'not created yet'}")
        sys.exit(0)
    if a.inspect:
        inspect()
        sys.exit(0)
    if a.probe:
        probe(MAP, "product_code", {
            "product_code": "__probe__", "ad_name": "probe row",
            "family": "probe"})
        sys.exit(0)
    if a.drop_obsolete:
        drop_fields(PERF, PERF_OBSOLETE, a.yes)
        drop_fields(MAP, ["dedup_key"], a.yes)
        sys.exit(0)
    if a.purge:
        if a.purge in ("map", "all"):
            purge(MAP, a.yes)
        if a.purge in ("perf", "all"):
            purge(PERF, a.yes)
        if a.purge in ("action", "all"):
            purge(ACTION, a.yes)
        sys.exit(0)
    if a.schema:
        create_collection(PERF, "Shopee Ads Performance", PERF_FIELDS)
        create_collection(MAP, "Shopee Product Map", MAP_FIELDS)
        create_collection(ACTION, "Shopee Ads Action Log", ACTION_FIELDS)
    if a.data:
        load_periods(a.data)
    if a.map:
        # always insert-only: never overwrite curated product_map rows
        upsert(MAP, a.map, "product_code", mode=a.mode, insert_only=True)
