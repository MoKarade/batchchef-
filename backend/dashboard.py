import sys, json, os, sqlite3
import tempfile
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
from datetime import datetime, timedelta

# Resolve paths relative to this script so the dashboard works from any
# checkout. Old hardcoded `C:/Users/dessin14/...` paths only worked on the
# original dev box.
_BACKEND = Path(__file__).resolve().parent
HIST = os.environ.get(
    "BATCHCHEF_DASHBOARD_HIST",
    str(Path(tempfile.gettempdir()) / "job_dashboard_history.json"),
)
DB = os.environ.get("BATCHCHEF_DASHBOARD_DB", str(_BACKEND / "batchchef.db"))

history = json.load(open(HIST)) if os.path.exists(HIST) else []

conn = sqlite3.connect(DB)
c = conn.cursor()

def get_job(jid):
    c.execute('SELECT id,status,progress_current,progress_total,started_at FROM import_job WHERE id=?', (jid,))
    return c.fetchone()

j78 = get_job(78)
c.execute("SELECT id,status,progress_current,progress_total,started_at FROM import_job WHERE job_type='price_mapping' ORDER BY id DESC LIMIT 1")
j_pm = c.fetchone()

c.execute('SELECT status, COUNT(*) FROM recipe GROUP BY status')
r_stat = dict(c.fetchall())
c.execute('SELECT pricing_status, COUNT(*) FROM recipe GROUP BY pricing_status')
p_stat = dict(c.fetchall())
c.execute('SELECT price_mapping_status, COUNT(*) FROM ingredient_master GROUP BY price_mapping_status')
i_stat = dict(c.fetchall())
c.execute('SELECT COUNT(*) FROM ingredient_master WHERE parent_id IS NULL')
n_parents = c.fetchone()[0]
c.execute('SELECT COUNT(*) FROM ingredient_master WHERE parent_id IS NOT NULL')
n_variants = c.fetchone()[0]
c.execute('SELECT COUNT(*) FROM ingredient_master')
n_ing_total = c.fetchone()[0]
c.execute('SELECT COUNT(*) FROM store_product WHERE is_validated=1')
sp_ok = c.fetchone()[0]
c.execute('SELECT COUNT(*) FROM store_product')
sp_all = c.fetchone()[0]
conn.close()

now = datetime.utcnow()
now_s = now.strftime('%Y-%m-%dT%H:%M:%S')

pt = {
    't':      now_s,
    'j78_cur': j78[2] if j78 else 0,
    'j78_tot': j78[3] if j78 else 33062,
    'j78_st':  j78[1] if j78 else '?',
    'j78_start': j78[4] if j78 else None,
    'j79_id':  j_pm[0] if j_pm else 79,
    'j79_cur': j_pm[2] if j_pm else 0,
    'j79_tot': j_pm[3] if j_pm else 0,
    'j79_st':  j_pm[1] if j_pm else '?',
    'j79_start': j_pm[4] if j_pm else None,
    'ai_done':  r_stat.get('ai_done', 0),
    'scraped':  r_stat.get('scraped', 0),
    'pr_ok':    p_stat.get('complete', 0),
    'pr_inc':   p_stat.get('incomplete', 0),
    'pr_pend':  p_stat.get('pending', 0),
    'pm_mapped':  i_stat.get('mapped', 0),
    'pm_invalid': i_stat.get('invalid', 0),
    'pm_pending': i_stat.get('pending', 0),
    'pm_variant': i_stat.get('variant', 0),
    'n_parents':  n_parents,
    'n_variants': n_variants,
    'n_ing':      n_ing_total,
    'sp_ok': sp_ok, 'sp_all': sp_all,
}

# Append or update last point if < 5 min old
if history and (now - datetime.fromisoformat(history[-1]['t'])).total_seconds() < 300:
    history[-1] = pt
else:
    history.append(pt)
json.dump(history, open(HIST, 'w'), indent=2)

# ── helpers ──────────────────────────────────────────────────────────────────
L  = '\u2500' * 76
VT = '\u2502'; TL = '\u250c'; TR = '\u2510'; BL = '\u2514'; BR = '\u2518'
LM = '\u251c'; RM = '\u2524'

def bar(val, total, w=48, full='\u2588', empty='\u2591'):
    if not total: return empty * w
    n = max(0, min(w, round(val / total * w)))
    return full * n + empty * (w - n)

def spark(vals, w=40):
    if not vals: return ' ' * w
    bl = ' \u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588'
    mx = max(vals) or 1
    s  = ''.join(bl[min(8, int(v / mx * 8))] for v in vals)
    return (s + ' ' * w)[:w]

def hdr(title):
    print(TL + L + TR)
    print(VT + '  ' + title + ' ' * max(0, 76 - len(title) - 2) + VT)
    print(LM + L + RM)

def ftr(): print(BL + L + BR)

def speed_eta(key, tot):
    pts = [p for p in history if p.get(key, 0) > 0]
    if len(pts) < 2: return 0.0, None
    spds = []
    for i in range(1, len(pts)):
        dh = (datetime.fromisoformat(pts[i]['t']) - datetime.fromisoformat(pts[i-1]['t'])).total_seconds() / 3600
        dv = pts[i][key] - pts[i-1][key]
        if dh > 0.05 and dv >= 0:
            spds.append(dv / dh)
    if not spds: return 0.0, None
    spd = sum(spds[-5:]) / len(spds[-5:])   # weighted on last 5 intervals
    eta = (tot - history[-1][key]) / spd if spd > 0 else None
    return spd, eta

def eta_str(eta):
    if eta is None or eta > 500: return 'calcul...'
    dt = now + timedelta(hours=eta)
    return f'{eta:.1f}h  ({dt.strftime("%d/%m %H:%M")})'

# ─────────────────────────────────────────────────────────────────────────────
print()
print(f'  \u23f0  {now.strftime("%H:%M")} UTC  \u2014  BatchChef Dashboard  \u2014  {len(history)} pts d\u2019historique')
print()

# ── GRAPH 1 : Import Marmiton ────────────────────────────────────────────────
c1, t1, s1 = pt['j78_cur'], pt['j78_tot'], pt['j78_st']
pct1 = c1 / t1 * 100 if t1 else 0
spd1, eta1 = speed_eta('j78_cur', t1)
elapsed1 = (now - datetime.fromisoformat(pt['j78_start'])).total_seconds() / 3600 if pt['j78_start'] else 0

hdr(f'GRAPH 1 \u2014 Import Marmiton  [{s1.upper()}]  job #78')
print(f'{VT}  {bar(c1, t1, 52)}  {pct1:5.1f}%  {VT}')
print(f'{VT}  {c1:,} / {t1:,}   \u23f1 {elapsed1:.1f}h   \u26a1 {spd1:,.0f} r/h   fin : {eta_str(eta1)}{" " * 5}{VT}')
print(f'{VT}  {spark([p["j78_cur"] for p in history])}{VT}')
ftr()
print()

# ── GRAPH 2 : Price Mapping ──────────────────────────────────────────────────
j2id = pt['j79_id']
c2, t2, s2 = pt['j79_cur'], pt['j79_tot'], pt['j79_st']
pct2 = c2 / t2 * 100 if t2 else 0
spd2, eta2 = speed_eta('j79_cur', t2 or 1)
elapsed2 = (now - datetime.fromisoformat(pt['j79_start'])).total_seconds() / 3600 if pt['j79_start'] else 0

hdr(f'GRAPH 2 \u2014 Price Mapping Maxi+Costco  [{s2.upper()}]  job #{j2id}')
if t2 > 0:
    print(f'{VT}  {bar(c2, t2, 52)}  {pct2:5.1f}%  {VT}')
    print(f'{VT}  {c2:,} / {t2:,} ingr.   \u23f1 {elapsed2:.1f}h   \u26a1 {spd2:,.0f} ing/h   fin : {eta_str(eta2)}{" " * 3}{VT}')
else:
    print(f'{VT}  Initialisation en cours...   \u23f1 {elapsed2:.1f}h depuis d\u00e9marrage   statut: {s2}{" " * 15}{VT}')
print(f'{VT}  {spark([p["j79_cur"] for p in history])}{VT}')
ftr()
print()

# ── GRAPH 3 : Recettes ───────────────────────────────────────────────────────
ai  = pt['ai_done'];  sc  = pt['scraped'];  tr  = ai + sc
pok = pt['pr_ok'];    pic = pt['pr_inc'];   ppd = pt['pr_pend']
tp  = pok + pic + ppd

hdr('GRAPH 3 \u2014 Recettes  (\u2b06 IA traitement + \u2b06 pricing)')
print(f'{VT}  Total en DB : {tr:,}   IA en cours depuis job #78{" " * 37}{VT}')
print(f'{VT}  \u2588 ai_done    {bar(ai,  tr, 46)}  {ai/tr*100:5.1f}%  {ai:,}  {VT}')
print(f'{VT}  \u2592 scraped    {bar(sc,  tr, 46, chr(9618), " ")}  {sc/tr*100:5.1f}%  {sc:,}  {VT}')
print(f'{VT}  {"─" * 74}{VT}')
print(f'{VT}  \u2588 prix complet {bar(pok, tp, 44)}  {pok/tp*100:4.1f}%  {pok:,}  {VT}')
print(f'{VT}  \u2592 incomplet   {bar(pic, tp, 44, chr(9618), " ")}  {pic/tp*100:4.1f}%  {pic:,}  {VT}')
print(f'{VT}  \u2591 pending     {bar(ppd, tp, 44, chr(9617), " ")}  {ppd/tp*100:4.1f}%  {ppd:,}  {VT}')
print(f'{VT}  ai_done \u25b2   {spark([p["ai_done"] for p in history])}{VT}')
ftr()
print()

# ── GRAPH 4 : Ingrédients price mapping ──────────────────────────────────────
# parents only for mapped/invalid/pending (variants shown separately)
npm = pt['pm_mapped']; npi = pt['pm_invalid']; npp = pt['pm_pending']
np  = pt['n_parents']   # 7 632 — denominator for the 3 statuts above
nv  = pt['n_variants']  # 13 xxx — shown separately

hdr('GRAPH 4 \u2014 Ingr\u00e9dients : price mapping  (\u2b06 job #' + str(j2id) + ')')
print(f'{VT}  {np:,} parents   {nv:,} variants   StoreProducts valid\u00e9s : {sp_ok}/{sp_all}{" " * 18}{VT}')
print(f'{VT}  {"─" * 74}{VT}')
print(f'{VT}  \u2588 mapped   {bar(npm, np, 46)}  {npm/np*100:5.1f}%  {npm:,}  {VT}')
print(f'{VT}  \u2591 invalid  {bar(npi, np, 46, chr(9617), " ")}  {npi/np*100:5.1f}%  {npi:,}  {VT}')
print(f'{VT}  \u2592 pending  {bar(npp, np, 46, chr(9618), " ")}  {npp/np*100:5.1f}%  {npp:,}  {VT}')
print(f'{VT}  \u2593 variants {bar(nv,  nv, 46, chr(9619), " ")}  (info)   {nv:,}  {VT}')
print(f'{VT}  mapped \u25b2   {spark([p["pm_mapped"] for p in history])}{VT}')
ftr()
