# CareGrid V2 — Problem Statement & Operational Objectives

## 1. Problem Statement

Intensive Care Unit (ICU) resources—specifically bed availability, mechanical ventilators, and specialized critical care staff—are strictly finite. In emergency, high-surge, or pandemic scenarios, the rate of patients requiring critical care can severely exceed available capacity.

Legacy ICU bed allocation heavily relies on ad-hoc clinician triage or manual first-come-first-served queues. These legacy approaches suffer from:
1. **Subjectivity & Human Fatigue**: High-stress triage decisions can lead to inconsistent prioritization across shifts.
2. **Lack of Transparency**: Allocations lack auditable records or mathematical explanations for patient ordering.
3. **Static Triage**: Traditional physiological scoring tools (e.g. static SOFA scores) do not dynamically re-arbitrate when waiting times advance or bed availability changes.

---

## 2. System Objectives

CareGrid provides a transparent, computational decision-support framework that dynamically prioritizes critical care patients based on multi-factor clinical urgency, survival likelihood, and waiting duration.

Key objectives:
- **Deterministic Prioritization**: Compute deterministic priority scores (0–100 scale) combining normalized severity, survival likelihood, and waiting duration.
- **Dynamic Re-Arbitration**: Automatically update patient rankings whenever new emergency patients arrive, patient severity spikes, waiting times elapse, or ICU beds become available.
- **Deterministic Tie-Breaking**: Enforce a transparent, multi-tier tie-breaking policy when patients have near-identical priority scores.
- **Auditable & Explainable Decision Support**: Generate deterministic natural language explanations for relative patient rankings and maintain an immutable event audit trail.

---

## 3. Input-Process-Output Framework

```text
INPUTS:
  - Clinical physiological parameters (SOFA, SAPS-I, GCS, HR, MAP, SaO2, Creatinine, WBC, Lactate, Urine Output)
  - Patient demographics & arrival timestamps
  - ICU capacity state (Total Beds, Occupied Beds, Available Beds)

PROCESS:
  1. Data Ingestion & Provenance Tagging (SOURCE_VALUE, DERIVED_VALUE, SIMULATED_VALUE)
  2. SOFA-Derived Severity Normalization: clamp(SOFA / 20.0 * 100, 0, 100)
  3. Weighted Factor Aggregation: Score = (Sev × W_sev) + (Surv × W_surv) + (Wait × W_wait)
  4. Deterministic Ranking & Near-Tie Arbitration
  5. State Transition & Audit Event Logging

OUTPUTS:
  - Ranked Critical Care Queue (#1 to #N)
  - Factor Contribution Breakdown (Severity, Survival, Wait)
  - Deterministic Explainability Summaries ("Why P-X is ranked above P-Y")
  - System Audit Log Trail
```

---

## 4. Clinician-in-the-Loop Safeguard & Limitations

> [!IMPORTANT]
> **CareGrid is a Decision-Support System, NOT an Autonomous Medical Authority.**
> - CareGrid does **NOT** diagnose medical conditions or prescribe treatments.
> - CareGrid does **NOT** autonomously override clinician judgment or make binding legal allocations.
> - Final clinical ICU admission and triage decisions remain strictly with authorized healthcare professionals.
