# CareGrid V2 — Methodology Document

This document provides a comprehensive Input-Process-Output breakdown of every stage of the CareGrid V2 prioritization and arbitration pipeline.

---

## 1. Data Ingestion & Data Provenance Policy

### Input
- `data/raw/X_train_2025.csv` (3,600+ clinical ICU records)
- `data/raw/patients.csv` (1,000 hospital patient demographics & arrival records)

### Process
- Load records using `DataLoader` (`src/data_loader.py`).
- Perform inner join on `recordid` and patient demographics.
- Apply explicit provenance classification (`src/provenance.py`):
  - `SOURCE_VALUE`: Direct un-modified CSV field (`SOFA`, `GCS_first`, `arrival_date`).
  - `DERIVED_VALUE`: Calculated score (`patient_id` = `P-{recordid}`, `severity` = SOFA normalized).
  - `SIMULATED_VALUE`: Prototype simulated parameters (`survival_likelihood`, `waiting_time_minutes`, `patient_status`).

### Output
- Standardized `Patient` domain instances.

---

## 2. Severity Normalization & Derivation

### Input
- Raw `SOFA` (Sequential Organ Failure Assessment) score ($0 \text{ to } 24+$).

### Process
- Transform SOFA score to a 0–100 normalized severity scale using formula:

$$\text{severity} = \text{clamp}\left(\frac{\text{SOFA}}{20.0} \times 100.0, 0, 100\right)$$

- Handles missing values or unexpected nulls by defaulting to `0.0`.

### Output
- `severity` float value in range $[0.0, 100.0]$.

---

## 3. Priority Engine Weighted Scoring

### Input
- `severity` ($0\text{--}100$)
- `survival_likelihood` ($0\text{--}100$)
- `waiting_time_minutes` (normalized via $\text{clamp}(wait / 120.0 \times 100, 0, 100)$)
- Configurable weights: $W_{\text{sev}} = 0.50, W_{\text{surv}} = 0.30, W_{\text{wait}} = 0.20$ ($\sum W = 1.0$)

### Process
- Compute individual factor contributions:
  $$\text{severity\_contribution} = \text{severity} \times W_{\text{sev}}$$
  $$\text{survival\_contribution} = \text{survival\_likelihood} \times W_{\text{surv}}$$
  $$\text{waiting\_contribution} = \text{normalized\_wait} \times W_{\text{wait}}$$
- Compute total priority score:
  $$\text{Priority Score} = \text{severity\_contribution} + \text{survival\_contribution} + \text{waiting\_contribution}$$

### Output
- `priority_score` float value ($0.0 \text{ to } 100.0$) and factor contribution object.

---

## 4. Deterministic Near-Tie Arbitration & Ranking

### Input
- Unsorted candidate patient population.
- Configurable near-tie threshold $\epsilon = 0.50$ score points.

### Process
- Sort patients in descending priority order.
- When $|\text{Score}_A - \text{Score}_B| \le 0.50$, apply 4-Tier Deterministic Hierarchy:
  - **Tier 1**: Higher `severity_contribution`
  - **Tier 2**: Longer `waiting_time_minutes`
  - **Tier 3**: Higher `survival_likelihood`
  - **Tier 4**: Lexicographical `patient_id` (`P-{recordid}`)
- Assign rank numbers ($1 \text{ to } N$) and compute rank shift deltas ($\Delta \text{Rank} = \text{Previous Rank} - \text{New Rank}$).

### Output
- Ranked patient queue with rank deltas and tie-break flags.

---

## 5. Dynamic Event Arbitration Engine

### Input
- System events (`NEW_PATIENT`, `SEVERITY_UPDATED`, `SURVIVAL_LIKELIHOOD_UPDATED`, `WAITING_TIME_ADVANCED`, `PATIENT_DISCHARGED`, `ICU_BED_AVAILABLE`).

### Process
- Apply state transition to patient entity or ICU capacity counter.
- Re-run `PriorityEngine.rank_patients()`.
- Compare Before and After queue states to identify patients moved up, moved down, or unchanged.
- Log event into `AuditLogger`.

### Output
- Updated queue state + structured audit log entry + Before/After delta breakdown.

---

## 6. Deterministic Explainability & Audit Logging

### Input
- Patient state & rank comparison request.

### Process
- Construct human-readable deterministic text summarizing factor contributions and comparison margins.
- Log event to in-memory structured event audit trail (`src/audit_logger.py`).

### Output
- Natural language explanation string + JSON audit trail entry.
