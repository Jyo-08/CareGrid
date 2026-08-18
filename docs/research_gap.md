# CareGrid V2 — Research Gap & Proposed Contribution

## 1. Identified Research Gap

While physiological scoring systems (SOFA, SAPS-I, NEWS2) and ethical triage guidelines exist independently in critical care literature, existing clinical software tools present a distinct gap:

1. **Fragmentation of Urgency vs Equity**: Mortality predictors focus exclusively on acute organ failure without integrating waiting-time equity factors. Conversely, standard hospital queue management systems focus on wait times without integrating multi-organ physiological failure scoring.
2. **Lack of Dynamic Re-Arbitration**: Existing systems treat triage as a static intake assessment rather than an active state machine. They fail to dynamically re-evaluate and re-rank candidate queues when capacity shifts or clinical conditions change.
3. **Lack of Deterministic Tie-Breaking**: When two critically ill patients present with near-identical priority scores, current systems revert to arbitrary database ordering or un-audited discretion.
4. **Opaque Decision Processes & Black-Box AI**: Machine learning scoring models lack deterministic explainability, making them difficult for clinicians to verify under crisis conditions.

---

## 2. Proposed CareGrid Contribution

CareGrid addresses this research gap by introducing a **unified, transparent computational decision-support framework** that integrates:

$$\text{Severity (Derived SOFA)} + \text{Survival Likelihood} + \text{Waiting Duration Equity} \implies \text{Dynamic Arbitration Engine}$$

Key architectural contributions of CareGrid V2:
1. **Multi-Factor Normalized Scoring**: Combines acute organ failure (SOFA derived), survival potential, and waiting duration into a single normalized 0–100 score.
2. **Real-Time Event-Sourced Re-Arbitration**: Re-evaluates queue rankings instantly upon `NEW_PATIENT`, `SEVERITY_UPDATED`, `WAITING_TIME_ADVANCED`, or `ICU_BED_AVAILABLE` events.
3. **Deterministic Multi-Tier Tie-Breaking**: Resolves near-tie scores ($\le 0.50$ point margin) through a strict, transparent 4-tier hierarchy.
4. **Deterministic Clinical Explainability & Audit Trail**: Generates human-readable justification for relative rankings without relying on generative LLM hallucination.
