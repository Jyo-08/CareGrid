# CareGrid V2 — Engineering Design Decisions

This document outlines key technical decisions and engineering rationales behind CareGrid V2:

---

## 1. Why Use SOFA for Severity Derivation?
- **Rationale**: SOFA (Sequential Organ Failure Assessment) is clinically validated worldwide as an objective index of organ failure in sepsis and critical illness.
- **Normalization Formula**: We scale SOFA ($0\text{--}20$) to a $0\text{--}100$ scale via $\text{clamp}(\text{SOFA} / 20.0 \times 100, 0, 100)$ to make it directly comparable with 0-100 survival likelihood and wait time factors.

---

## 2. Why Deterministic Priority Scoring Instead of Black-Box AI?
- **Rationale**: Critical care triage decisions must be auditable, repeatable, and mathematically transparent.
- **Safety**: A machine learning model or generative LLM can hallucinate priority rankings or produce non-deterministic score variations for identical clinical inputs. Deterministic scoring guarantees identical rankings for identical inputs.

---

## 3. Why Configurable Weighting Methodology?
- **Rationale**: Healthcare institutions operate under different operational guidelines or surge policies.
- **Flexibility**: Configurable weights ($W_{\text{sev}}=0.50, W_{\text{surv}}=0.30, W_{\text{wait}}=0.20$) allow clinical teams to adjust scoring priorities transparently.

---

## 4. Why Multi-Tier Deterministic Tie-Breaking?
- **Rationale**: In large queues, multiple patients can receive near-identical priority scores ($\Delta \le 0.50$).
- **Rule Hierarchy**: Reverting to random database ordering in a crisis is unacceptable. We enforce a 4-tier hierarchy (Severity Contribution $\rightarrow$ Wait Duration $\rightarrow$ Survival Potential $\rightarrow$ Patient ID) to resolve ties deterministically.

---

## 5. Why Explicit Data Provenance Tagging?
- **Rationale**: To prevent misleading evaluators or clinicians into believing synthetic prototype data represents actual clinical ground truth.
- **Labels**: All fields are tagged as `SOURCE_VALUE` (raw dataset), `DERIVED_VALUE` (mathematically calculated), or `SIMULATED_VALUE` (prototype simulation).

---

## 6. Why Clinician-in-the-Loop Architecture?
- **Rationale**: Medical ethics and legal standards require human clinical oversight.
- **Design Constraint**: CareGrid operates as an intelligent *decision-support system*, leaving final ICU bed allocation authority with authorized healthcare professionals.
