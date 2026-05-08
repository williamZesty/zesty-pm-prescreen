"""
Generates deterministic seed data + expected outputs for the screening test.

Run once during development; output is pasted into js/seed.js and
js/questions.js. Re-run if you change the dataset.

Usage:
    python3 scripts/generate_seed.py
"""

import json
import random
import sqlite3
from datetime import date, timedelta

import pandas as pd

random.seed(42)

STATES = ["CA", "FL", "TX", "NY", "CO"]
CLAIM_TYPES = ["Roof", "Water", "Fire", "Wind", "Theft"]
STATUSES = ["Open", "Approved", "Denied", "Paid"]
STREETS = [
    "Maple Ave", "Oak St", "Pine Rd", "Cedar Blvd", "Elm Way",
    "Birch Ct", "Spruce Ln", "Willow Dr", "Ash Pl", "Hickory Trail",
]
CITIES = {
    "CA": "Los Angeles", "FL": "Miami", "TX": "Austin",
    "NY": "Buffalo", "CO": "Denver",
}
FIRSTS = [
    "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery",
    "Quinn", "Sage", "Drew", "Reese", "Skyler", "Hayden", "Parker",
    "Rowan", "Emerson", "Finley", "Harper", "Jamie", "Kendall",
    "Logan", "Micah", "Noor", "Pat", "Robin", "Sam", "Toby", "Vic",
    "Wren", "Yael",
]
LASTS = [
    "Nguyen", "Patel", "Khan", "Garcia", "Smith", "Lee", "Brown",
    "Davis", "Wilson", "Martinez", "Anderson", "Taylor", "Thomas",
    "Hernandez", "Moore", "Jackson", "Martin", "Lopez", "Gonzalez",
    "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green",
    "Adams", "Nelson", "Baker", "Hall",
]


def random_date(start: date, end: date) -> str:
    delta = (end - start).days
    return (start + timedelta(days=random.randint(0, delta))).isoformat()


def gen_properties(n: int = 30):
    rows = []
    for i in range(1, n + 1):
        state = random.choice(STATES)
        rows.append({
            "property_id": i,
            "address": f"{random.randint(100, 9999)} {random.choice(STREETS)}, {CITIES[state]}",
            "state": state,
            "year_built": random.randint(1920, 2020),
            "roof_age_years": random.randint(1, 35),
            "square_feet": random.randint(800, 4500),
        })
    return rows


def gen_policies(properties):
    rows = []
    for i, p in enumerate(properties, start=1):
        rows.append({
            "policy_id": i,
            "property_id": p["property_id"],
            "customer_name": f"{random.choice(FIRSTS)} {random.choice(LASTS)}",
            "annual_premium": round(random.uniform(800, 3000), 2),
            "coverage_amount": float(random.randint(200_000, 1_000_000)),
            "start_date": random_date(date(2022, 1, 1), date(2024, 6, 30)),
        })
    return rows


def gen_claims(policies, n: int = 50):
    rows = []
    for i in range(1, n + 1):
        policy = random.choice(policies)
        rows.append({
            "claim_id": i,
            "policy_id": policy["policy_id"],
            "claim_date": random_date(date(2023, 1, 1), date(2025, 12, 31)),
            "claim_amount": round(random.uniform(500, 50_000), 2),
            "claim_type": random.choice(CLAIM_TYPES),
            "status": random.choice(STATUSES),
        })
    return rows


def main():
    properties = gen_properties()
    policies = gen_policies(properties)
    claims = gen_claims(policies)

    # Build SQLite for SQL expected outputs
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE properties (
          property_id INTEGER PRIMARY KEY,
          address TEXT, state TEXT, year_built INTEGER,
          roof_age_years INTEGER, square_feet INTEGER
        )""")
    cur.execute("""
        CREATE TABLE policies (
          policy_id INTEGER PRIMARY KEY, property_id INTEGER,
          customer_name TEXT, annual_premium REAL,
          coverage_amount REAL, start_date TEXT
        )""")
    cur.execute("""
        CREATE TABLE claims (
          claim_id INTEGER PRIMARY KEY, policy_id INTEGER,
          claim_date TEXT, claim_amount REAL,
          claim_type TEXT, status TEXT
        )""")
    cur.executemany(
        "INSERT INTO properties VALUES (:property_id,:address,:state,:year_built,:roof_age_years,:square_feet)",
        properties,
    )
    cur.executemany(
        "INSERT INTO policies VALUES (:policy_id,:property_id,:customer_name,:annual_premium,:coverage_amount,:start_date)",
        policies,
    )
    cur.executemany(
        "INSERT INTO claims VALUES (:claim_id,:policy_id,:claim_date,:claim_amount,:claim_type,:status)",
        claims,
    )
    conn.commit()

    # Q1 expected
    q1 = cur.execute("""
        SELECT claim_id, claim_amount, claim_type
        FROM claims
        WHERE status = 'Open' AND claim_amount > 5000
        ORDER BY claim_amount DESC
    """).fetchall()
    q1_cols = ["claim_id", "claim_amount", "claim_type"]
    q1_rows = [list(r) for r in q1]

    # Q2 expected
    q2 = cur.execute("""
        SELECT p.state,
               COUNT(DISTINCT p.property_id) AS property_count,
               COALESCE(SUM(c.claim_amount), 0) AS total_claim_amount
        FROM properties p
        LEFT JOIN policies po ON p.property_id = po.property_id
        LEFT JOIN claims c ON po.policy_id = c.policy_id
        GROUP BY p.state
        ORDER BY total_claim_amount DESC
    """).fetchall()
    q2_cols = ["state", "property_count", "total_claim_amount"]
    q2_rows = [list(r) for r in q2]

    # Q3 expected (Python / pandas)
    properties_df = pd.DataFrame(properties)
    policies_df = pd.DataFrame(policies)
    claims_df = pd.DataFrame(claims)

    q3_df = properties_df[
        (properties_df["state"] == "CA") & (properties_df["roof_age_years"] > 15)
    ].reset_index(drop=True)

    # Q4 expected
    sums = claims_df.groupby("policy_id", as_index=False)["claim_amount"].sum()
    q4_df = sums.merge(
        policies_df[["policy_id", "annual_premium"]], on="policy_id"
    )
    q4_df["loss_ratio"] = q4_df["claim_amount"] / q4_df["annual_premium"]
    q4_df = (
        q4_df[["policy_id", "loss_ratio"]]
        .sort_values("loss_ratio", ascending=False)
        .reset_index(drop=True)
    )

    out = {
        "properties": properties,
        "policies": policies,
        "claims": claims,
        "expected": {
            "q1": {"columns": q1_cols, "rows": q1_rows},
            "q2": {"columns": q2_cols, "rows": q2_rows},
            "q3": {
                "columns": list(q3_df.columns),
                "rows": q3_df.values.tolist(),
            },
            "q4": {
                "columns": list(q4_df.columns),
                "rows": [[int(p), float(r)] for p, r in q4_df.values.tolist()],
            },
        },
    }

    with open("scripts/seed_output.json", "w") as f:
        json.dump(out, f, indent=2, default=str)

    print(f"Properties: {len(properties)}")
    print(f"Policies:   {len(policies)}")
    print(f"Claims:     {len(claims)}")
    print(f"Q1 rows:    {len(q1_rows)}")
    print(f"Q2 rows:    {len(q2_rows)}")
    print(f"Q3 rows:    {len(q3_df)}")
    print(f"Q4 rows:    {len(q4_df)}")
    print("\nWrote scripts/seed_output.json")


if __name__ == "__main__":
    main()
