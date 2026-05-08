// Question prompts shown to candidates. Expected outputs live in seed.js
// next to the seed data — both are produced by scripts/generate_seed.py.

export const QUESTIONS = [
  {
    id: "q1",
    title: "Q1 — SQL: Filter and sort claims",
    language: "sql",
    suggestedMinutes: 4,
    prompt: `Return all **open** claims (\`status = 'Open'\`) with **claim amount over $5,000**.

Show columns \`claim_id\`, \`claim_amount\`, \`claim_type\`. Sort by \`claim_amount\` descending.

**Tables available:** \`properties\`, \`policies\`, \`claims\` — see schema in the sidebar.`,
    starter: "-- Write your SQL here\nSELECT ...\n",
  },
  {
    id: "q2",
    title: "Q2 — SQL: Property and claim totals by state",
    language: "sql",
    suggestedMinutes: 6,
    prompt: `For each state, calculate:

1. The count of properties (\`property_count\`)
2. The total claim amount across all claims on policies for those properties (\`total_claim_amount\`)

Return columns \`state\`, \`property_count\`, \`total_claim_amount\`. Sort by \`total_claim_amount\` descending.

**Important:** States with no claims should still appear (with \`0\` total_claim_amount).`,
    starter: "-- Write your SQL here\nSELECT ...\n",
  },
  {
    id: "q3",
    title: "Q3 — Python: Filter properties by state and roof age",
    language: "python",
    suggestedMinutes: 4,
    prompt: `Given \`properties_df\`, assign to a variable named \`result\` a DataFrame containing only properties in **California** (\`state == 'CA'\`) where \`roof_age_years\` is **greater than 15**.

Include all columns.

\`pandas\` is already imported as \`pd\`. \`properties_df\`, \`policies_df\`, and \`claims_df\` are pre-loaded.`,
    starter: "# Write your Python here\n# pandas is imported as pd\n# properties_df, policies_df, claims_df are loaded\n\nresult = ...\n",
  },
  {
    id: "q4",
    title: "Q4 — Python: Loss ratio by policy",
    language: "python",
    suggestedMinutes: 6,
    prompt: `Using \`policies_df\` and \`claims_df\`, calculate the **loss ratio** (sum of \`claim_amount\` divided by \`annual_premium\`) for each policy.

Assign to \`result\` a DataFrame with columns \`policy_id\` and \`loss_ratio\`, sorted by \`loss_ratio\` descending.

**Include only policies that have at least one claim.**`,
    starter: "# Write your Python here\n# pandas is imported as pd\n# properties_df, policies_df, claims_df are loaded\n\nresult = ...\n",
  },
];

// Schema reference shown in the sidebar so candidates don't have to guess.
export const SCHEMA_REFERENCE = `properties(property_id, address, state, year_built, roof_age_years, square_feet)
policies(policy_id, property_id, customer_name, annual_premium, coverage_amount, start_date)
claims(claim_id, policy_id, claim_date, claim_amount, claim_type, status)

Notes:
  - states: CA, FL, TX, NY, CO
  - claim_type: Roof, Water, Fire, Wind, Theft
  - status:     Open, Approved, Denied, Paid`;
