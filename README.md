# CAREGRID V2 — INTELLIGENT ICU BED ARBITRATION & PRIORITIZATION ENGINE

**CareGrid V2** is a rubric-maximizing research and decision-support implementation for intelligent ICU bed arbitration and critical care prioritization.

Building directly on the clean V1 dataset foundation, CareGrid V2 introduces dynamic event-driven arbitration, deterministic multi-tier tie-breaking, real-time scenario simulation, clinical explainability, and immutable event audit logging.

---

## 1. Data Sources & Provenance Policy

CareGrid V2 strictly uses the two hackathon datasets:
- `data/raw/X_train_2025.csv` (3,600+ clinical ICU records with 120+ physiological parameters)
- `data/raw/patients.csv` (1,000 hospital patient demographic records)

### Data Provenance Taxonomy
| Provenance Tag | Description | Example Fields |
| :--- | :--- | :--- |
| `SOURCE_VALUE` | Direct un-modified value from verified raw CSV datasets | `SOFA`, `SAPS-I`, `GCS_first`, `arrival_date`, `HR_first` |
| `DERIVED_VALUE` | Mathematically transformed/calculated value | `patient_id` (`P-{recordid}`), `severity` (SOFA derived 0-100) |
| `SIMULATED_VALUE` | Synthetic V2 prototype demonstration value | `survival_likelihood`, `waiting_time_minutes`, `patient_status` |

---

## 2. Priority Engine & Normalization Methodology

Severity is normalized from the raw SOFA organ failure score:

$$\text{severity} = \text{clamp}\left(\frac{\text{SOFA}}{20.0} \times 100.0, 0, 100\right)$$

The Priority Engine aggregates three 0–100 factors using configurable normalized weights:

$$\text{Priority Score} = (\text{Severity} \times W_{\text{sev}}) + (\text{Survival Likelihood} \times W_{\text{surv}}) + (\text{Normalized Wait} \times W_{\text{wait}})$$

### Default Weights
- $W_{\text{sev}} = 0.50$ (Severity weight)
- $W_{\text{surv}} = 0.30$ (Survival likelihood weight)
- $W_{\text{wait}} = 0.20$ (Waiting duration weight)

---

## 3. Deterministic 4-Tier Tie-Breaking Policy

When two candidate patients have near-identical priority scores ($|\text{Score}_A - \text{Score}_B| \le 0.50$), CareGrid resolves the tie using a strict deterministic hierarchy:

1. **Tier 1**: Higher Severity Contribution (`severity_contribution`)
2. **Tier 2**: Longer Waiting Duration (`waiting_time_minutes`)
3. **Tier 3**: Higher Survival Likelihood (`survival_likelihood`)
4. **Tier 4**: Lexicographical Patient ID (`P-{recordid}`)

---

## 4. Documentation Index (`docs/`)

The repository contains 10 detailed research, architectural, and presentation documents:

- 📄 [`docs/problem_statement.md`](file:///Users/jyotish/.gemini/antigravity-ide/scratch/caregrid/docs/problem_statement.md) — Problem definition, operational objectives, and clinician-in-the-loop principle.
- 📄 [`docs/literature_review.md`](file:///Users/jyotish/.gemini/antigravity-ide/scratch/caregrid/docs/literature_review.md) — Comprehensive survey of SOFA, SAPS, NEWS2, and MCDA literature with genuine citations.
- 📄 [`docs/research_gap.md`](file:///Users/jyotish/.gemini/antigravity-ide/scratch/caregrid/docs/research_gap.md) — CareGrid's core research gap and proposed contributions.
- 📄 [`docs/methodology.md`](file:///Users/jyotish/.gemini/antigravity-ide/scratch/caregrid/docs/methodology.md) — 16-stage Input-Process-Output methodology.
- 📄 [`docs/system_architecture.md`](file:///Users/jyotish/.gemini/antigravity-ide/scratch/caregrid/docs/system_architecture.md) — Component architecture and data/event flow diagrams.
- 📄 [`docs/design_decisions.md`](file:///Users/jyotish/.gemini/antigravity-ide/scratch/caregrid/docs/design_decisions.md) — Engineering justifications for design choices.
- 📄 [`docs/demo_script.md`](file:///Users/jyotish/.gemini/antigravity-ide/scratch/caregrid/docs/demo_script.md) — 3 to 5 minute live hackathon demonstration script.
- 📄 [`docs/judge_questions.md`](file:///Users/jyotish/.gemini/antigravity-ide/scratch/caregrid/docs/judge_questions.md) — 10 comprehensive Q&A responses for competition judges.
- 📄 [`docs/rubric_traceability.md`](file:///Users/jyotish/.gemini/antigravity-ide/scratch/caregrid/docs/rubric_traceability.md) — Explicit mapping of competition criteria (15 marks) to project evidence.
- 📄 [`docs/validation_report.md`](file:///Users/jyotish/.gemini/antigravity-ide/scratch/caregrid/docs/validation_report.md) — Real dataset sanity report and test execution results.

---

## 5. Running & Testing CareGrid V2

### Run Unit Test Suite (20 Tests)
```bash
python3 -m unittest discover -s tests
```

### Start Web Server
```bash
python3 -m src.server
```
Open `http://localhost:8080` in your web browser.

---

## 6. Clinical Disclaimer

> [!IMPORTANT]
> **CareGrid V2 is a decision-support research prototype.**
> - CareGrid does **NOT** autonomously make binding medical allocations or prescribe treatment.
> - Final clinical ICU allocation authority remains strictly with authorized healthcare professionals.
