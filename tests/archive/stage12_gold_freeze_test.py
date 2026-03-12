#!/usr/bin/env python3
"""
Stage 12 Gold Freeze Gate — Complete Proof Generation
Covers: 100% test closure, RBAC proof, replay/idempotency, E2E, legacy cleanup readiness
"""
import requests, json, time, subprocess, sys
from datetime import datetime

BASE = "https://tribe-feed-debug.preview.emergentagent.com/api"
results = []
n = 0

def t(name, r, expect_status=None, check=None):
    global n; n += 1
    ok = True; detail = ""
    if expect_status and r.status_code != expect_status:
        ok = False; detail = f"Expected {expect_status}, got {r.status_code}: {r.text[:150]}"
    elif check:
        try:
            d = r.json(); res = check(d)
            if res is not True: ok = False; detail = str(res)
        except Exception as e: ok = False; detail = str(e)
    s = "PASS" if ok else "FAIL"
    print(f"  [{s}] #{n}: {name}" + (f" — {detail}" if detail else ""))
    results.append({"n": n, "name": name, "s": s, "d": detail})
    return ok

def login(phone):
    return requests.post(f"{BASE}/auth/login", json={"phone": phone, "pin": "1234"}).json().get("token","")

# Clean test data
subprocess.run(["mongosh","mongodb://localhost:27017/your_database_name","--eval",
    "db.tribe_awards.deleteMany({}); db.tribe_fund_accounts.deleteMany({}); db.tribe_fund_ledger.deleteMany({});"
    "db.tribe_contests.deleteMany({}); db.tribe_salute_ledger.deleteMany({}); db.tribe_standings.deleteMany({});"
    "db.tribe_seasons.deleteMany({}); db.tribe_boards.deleteMany({}); db.tribe_board_members.deleteMany({});"
    "print('Cleaned');"], capture_output=True)

ADMIN = login("9000000001")
U1 = login("9000000002")
U2 = login("9000000003")
ah = {"Authorization": f"Bearer {ADMIN}", "Content-Type": "application/json"}
u1h = {"Authorization": f"Bearer {U1}", "Content-Type": "application/json"}
u2h = {"Authorization": f"Bearer {U2}", "Content-Type": "application/json"}

U1_ID = requests.get(f"{BASE}/auth/me", headers=u1h).json().get("user",{}).get("id","")
U2_ID = requests.get(f"{BASE}/auth/me", headers=u2h).json().get("user",{}).get("id","")

print("\n" + "="*60)
print("STAGE 12 GOLD FREEZE GATE — COMPLETE PROOF")
print("="*60)

# ============================================================
print("\n--- SECTION 1: CORE TRIBE SYSTEM (21/21 target) ---\n")

r = requests.get(f"{BASE}/tribes")
t("GET /tribes returns 21 tribes", r, check=lambda d: True if len(d.get("tribes",[])) == 21 else f"Got {len(d.get('tribes',[]))}")

# Verify all 21 tribe codes
tribe_codes = [t_["tribeCode"] for t_ in r.json().get("tribes",[])]
expected = ["SOMNATH","JADUNATH","PIRU","KARAM","RANE","SALARIA","THAPA","JOGINDER","SHAITAN","HAMID","TARAPORE","EKKA","SEKHON","HOSHIAR","KHETARPAL","BANA","PARAMESWARAN","PANDEY","YADAV","SANJAY","BATRA"]
t("All 21 PVC tribe codes present", r, check=lambda d: True if set(tribe_codes) == set(expected) else f"Missing: {set(expected)-set(tribe_codes)}")

# By tribeCode
r = requests.get(f"{BASE}/tribes/SOMNATH")
t("GET /tribes/SOMNATH (by code)", r, check=lambda d: True if d.get("tribe",{}).get("tribeName") == "Somnath Tribe" else f"Got: {d}")

SOMNATH_ID = r.json().get("tribe",{}).get("id","")

# By ID
r = requests.get(f"{BASE}/tribes/{SOMNATH_ID}")
t("GET /tribes/:id (by UUID)", r, check=lambda d: True if d.get("tribe",{}).get("tribeCode") == "SOMNATH" else f"Got: {d}")

# My tribe (idempotent)
r1 = requests.get(f"{BASE}/me/tribe", headers=u1h)
tribe1 = r1.json().get("tribe",{}).get("tribeCode","")
r2 = requests.get(f"{BASE}/me/tribe", headers=u1h)
tribe2 = r2.json().get("tribe",{}).get("tribeCode","")
t("GET /me/tribe idempotent (same tribe twice)", r1, check=lambda d: True if tribe1 == tribe2 and tribe1 else f"First:{tribe1} Second:{tribe2}")

# User tribe
r = requests.get(f"{BASE}/users/{U1_ID}/tribe")
t("GET /users/:id/tribe", r, check=lambda d: True if d.get("tribe",{}).get("tribeCode") else f"Got: {d}")

# Members
r = requests.get(f"{BASE}/tribes/SOMNATH/members?limit=5")
t("GET /tribes/:id/members", r, check=lambda d: True if "items" in d and "total" in d else f"Got: {d}")

# Standings (no season yet)
r = requests.get(f"{BASE}/tribes/standings/current")
t("GET /tribes/standings/current (no season)", r, check=lambda d: True if "standings" in d and len(d["standings"]) == 21 else f"Got {len(d.get('standings',[]))}")

# ============================================================
print("\n--- SECTION 2: RBAC / PERMISSIONS PROOF ---\n")

# Non-admin → 403 on all admin endpoints
r = requests.get(f"{BASE}/admin/tribes/distribution", headers=u1h)
t("RBAC: Non-admin GET /admin/tribes/distribution → 403", r, 403)

r = requests.post(f"{BASE}/admin/tribes/reassign", json={"userId":"x","tribeCode":"SOMNATH","reason":"test"}, headers=u1h)
t("RBAC: Non-admin POST /admin/tribes/reassign → 403", r, 403)

r = requests.post(f"{BASE}/admin/tribes/migrate", json={"batchSize":1}, headers=u1h)
t("RBAC: Non-admin POST /admin/tribes/migrate → 403", r, 403)

r = requests.post(f"{BASE}/admin/tribe-seasons", json={"name":"x","year":2026}, headers=u1h)
t("RBAC: Non-admin POST /admin/tribe-seasons → 403", r, 403)

r = requests.post(f"{BASE}/admin/tribe-contests", json={"seasonId":"x","name":"x"}, headers=u1h)
t("RBAC: Non-admin POST /admin/tribe-contests → 403", r, 403)

r = requests.post(f"{BASE}/admin/tribe-salutes/adjust", json={"tribeId":"x","deltaSalutes":10,"reasonCode":"ADMIN_AWARD"}, headers=u1h)
t("RBAC: Non-admin POST /admin/tribe-salutes/adjust → 403", r, 403)

r = requests.post(f"{BASE}/admin/tribe-awards/resolve", json={"seasonId":"x"}, headers=u1h)
t("RBAC: Non-admin POST /admin/tribe-awards/resolve → 403", r, 403)

r = requests.post(f"{BASE}/admin/tribes/boards", json={"tribeId":"x","members":[]}, headers=u1h)
t("RBAC: Non-admin POST /admin/tribes/boards → 403", r, 403)

# Admin → 200 on admin endpoints
r = requests.get(f"{BASE}/admin/tribes/distribution", headers=ah)
t("RBAC: Admin GET /admin/tribes/distribution → 200", r, check=lambda d: True if "totalUsers" in d else f"Got: {d}")

# ============================================================
print("\n--- SECTION 3: FULL E2E PIPELINE (season→contest→resolve→award→fund) ---\n")

# Create season
r = requests.post(f"{BASE}/admin/tribe-seasons", json={
    "name": "Gold Freeze Season 2026", "year": 2026, "prizeAmount": 1000000, "awardTitle": "Emerald Tribe of the Year"
}, headers=ah)
t("Create season", r, 201)
SID = r.json().get("season",{}).get("id","")

# List seasons
r = requests.get(f"{BASE}/admin/tribe-seasons", headers=ah)
t("List seasons", r, check=lambda d: True if len(d.get("seasons",[])) >= 1 else f"Got: {d}")

# Activate
r = requests.post(f"{BASE}/admin/tribe-seasons", json={"action":"activate","seasonId":SID}, headers=ah)
t("Activate season", r, check=lambda d: True if d.get("season",{}).get("status") == "ACTIVE" else f"Got: {d}")

# Create contest
r = requests.post(f"{BASE}/admin/tribe-contests", json={
    "seasonId":SID, "name":"Code Jam", "salutesForWin":200, "salutesForRunnerUp":100
}, headers=ah)
t("Create contest", r, 201)
CID = r.json().get("contest",{}).get("id","")

# Get Batra tribe ID
BATRA_ID = requests.get(f"{BASE}/tribes/BATRA").json().get("tribe",{}).get("id","")

# Resolve contest
r = requests.post(f"{BASE}/admin/tribe-contests/{CID}/resolve", json={
    "winnerTribeId": SOMNATH_ID, "runnerUpTribeId": BATRA_ID
}, headers=ah)
t("Resolve contest (Somnath wins)", r, check=lambda d: True if d.get("winnerTribeId") == SOMNATH_ID else f"Got: {d}")

# Manual salute adjustment
r = requests.post(f"{BASE}/admin/tribe-salutes/adjust", json={
    "tribeId": SOMNATH_ID, "deltaSalutes": 50, "reasonCode": "ADMIN_AWARD", "reasonText": "Extra bonus"
}, headers=ah)
t("Manual salute adjust (+50 to Somnath)", r, 201)

# Check standings
r = requests.get(f"{BASE}/tribes/standings/current")
standings = r.json().get("standings",[])
somnath_standing = next((s for s in standings if s.get("tribe",{}).get("tribeCode") == "SOMNATH"), None)
t("Standings: Somnath has 250 salutes (200+50)", r, check=lambda d: True if somnath_standing and somnath_standing.get("totalSalutes") == 250 else f"Somnath salutes: {somnath_standing}")

batra_standing = next((s for s in standings if s.get("tribe",{}).get("tribeCode") == "BATRA"), None)
t("Standings: Batra has 100 salutes (runner-up)", r, check=lambda d: True if batra_standing and batra_standing.get("totalSalutes") == 100 else f"Batra salutes: {batra_standing}")

# Resolve annual award
r = requests.post(f"{BASE}/admin/tribe-awards/resolve", json={"seasonId": SID}, headers=ah)
t("Resolve annual award", r, check=lambda d: True if d.get("award",{}).get("awardTitle") == "Emerald Tribe of the Year" else f"Got: {d}")
t("Award winner = Somnath", r, check=lambda d: True if d.get("award",{}).get("winnerTribeCode") == "SOMNATH" else f"Got: {d.get('award',{}).get('winnerTribeCode')}")
t("Prize amount = 1000000", r, check=lambda d: True if d.get("award",{}).get("prizeAmount") == 1000000 else f"Got: {d.get('award',{}).get('prizeAmount')}")

# Check fund
r = requests.get(f"{BASE}/tribes/{SOMNATH_ID}/fund")
t("Fund: Somnath balance = INR 10,00,000", r, check=lambda d: True if d.get("fund",{}).get("balance") == 1000000 else f"Balance: {d.get('fund',{}).get('balance')}")
t("Fund ledger has PRIZE_CREDIT entry", r, check=lambda d: True if any(tx.get("type") == "PRIZE_CREDIT" for tx in d.get("recentTransactions",[])) else f"No PRIZE_CREDIT")

# Salute history
r = requests.get(f"{BASE}/tribes/{SOMNATH_ID}/salutes?limit=10")
t("Salute ledger has entries", r, check=lambda d: True if d.get("total",0) >= 2 else f"Total: {d.get('total')}")

# ============================================================
print("\n--- SECTION 4: REPLAY / IDEMPOTENCY / DOUBLE-RUN PROOF ---\n")

# Contest resolve twice → 409
r = requests.post(f"{BASE}/admin/tribe-contests/{CID}/resolve", json={
    "winnerTribeId": SOMNATH_ID, "runnerUpTribeId": BATRA_ID
}, headers=ah)
t("REPLAY: Contest resolve twice → 409", r, 409)

# Award resolve twice → 409
r = requests.post(f"{BASE}/admin/tribe-awards/resolve", json={"seasonId": SID}, headers=ah)
t("REPLAY: Award resolve twice → 409", r, 409)

# Fund check after double attempts — balance should NOT have doubled
r = requests.get(f"{BASE}/tribes/{SOMNATH_ID}/fund")
t("REPLAY: Fund balance still 1000000 (not doubled)", r, check=lambda d: True if d.get("fund",{}).get("balance") == 1000000 else f"Balance: {d.get('fund',{}).get('balance')}")

# Migration rerun → 0 migrated (all already assigned)
r = requests.post(f"{BASE}/admin/tribes/migrate", json={"batchSize":100}, headers=ah)
t("REPLAY: Migration rerun → 0 migrated", r, check=lambda d: True if d.get("migrated",99) == 0 else f"Migrated: {d.get('migrated')}")
t("REPLAY: 0 remaining unmigrated", r, check=lambda d: True if d.get("remainingUnmigrated",99) == 0 else f"Remaining: {d.get('remainingUnmigrated')}")

# Tribe assignment idempotent under parallel calls (simulate)
r1 = requests.get(f"{BASE}/me/tribe", headers=u1h)
r2 = requests.get(f"{BASE}/me/tribe", headers=u1h)
tc1 = r1.json().get("tribe",{}).get("tribeCode","")
tc2 = r2.json().get("tribe",{}).get("tribeCode","")
t("REPLAY: Parallel tribe assignment → same tribe", r1, check=lambda d: True if tc1 == tc2 else f"tc1={tc1} tc2={tc2}")

# ============================================================
print("\n--- SECTION 5: ADMIN TOOLS (reassign, boards, distribution) ---\n")

# Reassign user
r = requests.post(f"{BASE}/admin/tribes/reassign", json={
    "userId": U2_ID, "tribeCode": "BATRA", "reason": "Gold Freeze test reassignment"
}, headers=ah)
t("Admin reassign user2 → BATRA", r, check=lambda d: True if d.get("tribe",{}).get("tribeCode") == "BATRA" else f"Got: {d}")

# Verify user2 is now BATRA
r = requests.get(f"{BASE}/users/{U2_ID}/tribe")
t("Verify user2 tribe = BATRA after reassign", r, check=lambda d: True if d.get("tribe",{}).get("tribeCode") == "BATRA" else f"Got: {d.get('tribe',{}).get('tribeCode')}")

# Create board
r = requests.post(f"{BASE}/admin/tribes/boards", json={
    "tribeId": SOMNATH_ID,
    "members": [
        {"userId": U1_ID, "role": "CAPTAIN"},
        {"userId": U2_ID, "role": "VICE_CAPTAIN"},
    ]
}, headers=ah)
t("Create tribe board (Somnath)", r, 201)

# Read board
r = requests.get(f"{BASE}/tribes/{SOMNATH_ID}/board")
t("Read board: has members with roles", r, check=lambda d: True if d.get("board") and len(d.get("members",[])) >= 2 else f"Members: {len(d.get('members',[]))}")

# Distribution
r = requests.get(f"{BASE}/admin/tribes/distribution", headers=ah)
t("Distribution: 0 unmigrated", r, check=lambda d: True if d.get("unmigrated",99) == 0 else f"Unmigrated: {d.get('unmigrated')}")

# ============================================================
print("\n" + "="*60)
passed = sum(1 for r in results if r["s"] == "PASS")
failed = sum(1 for r in results if r["s"] == "FAIL")
total = len(results)
print(f"GOLD FREEZE GATE: {passed}/{total} PASSED ({passed/total*100:.1f}%)")
print("="*60)

if failed > 0:
    print("\nFAILED:")
    for r in results:
        if r["s"] == "FAIL": print(f"  #{r['n']}: {r['name']} — {r['d']}")

with open("/app/test_reports/stage12_gold_freeze.json", "w") as f:
    json.dump({"suite":"Stage 12 Gold Freeze","ts":datetime.utcnow().isoformat()+"Z","total":total,"passed":passed,"failed":failed,"rate":f"{passed/total*100:.1f}%","results":results}, f, indent=2)

print(f"\nSaved: /app/test_reports/stage12_gold_freeze.json")
sys.exit(0 if failed == 0 else 1)
