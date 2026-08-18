# CareGrid V2 — 3 to 5 Minute Hackathon Presentation Script

## Step-by-Step Demonstration Walkthrough

### 1. Introduction (30 seconds)
> "Judges, this is **CareGrid V2**, an Intelligent ICU Bed Arbitration and Critical Care Prioritization Engine.
> In surge or emergency scenarios, critical care resources are constrained. Legacy allocation relies on ad-hoc manual queuing or static scoring. CareGrid provides a transparent, auditable, computational decision-support system."

### 2. Dataset Foundation & Provenance (45 seconds)
> "CareGrid V2 runs on real clinical data—3,600 ICU patient records from `X_train_2025.csv` joined with 1,000 hospital records from `patients.csv`.
> Every field displays explicit Data Provenance: `SOURCE_VALUE` for raw clinical parameters like SOFA and GCS, `DERIVED_VALUE` for SOFA-derived severity (0–100 scale), and `SIMULATED_VALUE` for prototype demonstration fields like survival likelihood and wait times."

### 3. Priority Scoring & Configurable Weights (45 seconds)
> "Our deterministic engine calculates a priority score based on:
> 1. Severity (SOFA derived, 50% default weight)
> 2. Survival Likelihood (30% weight)
> 3. Waiting Time Equity (20% weight)
> Watch as we adjust the Severity weight slider to 0.80 and click **'Apply & Re-rank Engine'**. The engine dynamically recalculates priority scores across all 3,600 records in real time."

### 4. Dynamic Event Simulation & Re-Arbitration (60 seconds)
> "Now let's demonstrate real dynamic event arbitration:
> - Click **'+ Add Emergency Patient'**: A new critical patient arrives with SOFA 18. The engine immediately re-ranks the queue, promoting the emergency arrival to Rank #1.
> - Click **'⚡ Severity Spike'**: Patient `P-137517` suffers septic deterioration (SOFA 2 $\rightarrow$ 19). Notice `P-137517` jumps from Rank #2630 up to Rank #2.
> - Click **'🏥 Discharge Top Patient'**: The top patient is allocated an ICU bed and discharged, updating ICU bed capacity counters."

### 5. Audit Trail & Deterministic Explainability (45 seconds)
> "Click **'📜 Audit Log'**: Every state transition, score recalculation, and rank shift is recorded in an immutable event audit trail.
> Click **'View'** on any patient row to open the Detail Modal. CareGrid generates deterministic, human-readable explanations explaining *why* patient A is prioritized over patient B and displaying full organ dysfunction metrics."

### 6. Conclusion & Clinician Safeguard (15 seconds)
> "CareGrid V2 combines research-backed severity modeling, dynamic event arbitration, deterministic tie-breaking, and transparent auditability—while strictly preserving clinician-in-the-loop oversight."
