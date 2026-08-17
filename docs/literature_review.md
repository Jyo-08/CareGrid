# CareGrid V2 — Literature Review

## 1. Overview of Existing Critical Care Triage Literature

Prioritization and capacity allocation in intensive care units (ICUs) have been extensively studied across critical care medicine, medical informatics, and operations research. Existing approaches generally fall into three major domains:

### A. Organ Dysfunction & Physiological Mortality Scoring Systems
1. **SOFA (Sequential Organ Failure Assessment)**
   - *Reference*: Vincent, J. L., et al. (1996). "The SOFA (Sepsis-related Organ Failure Assessment) score to describe organ dysfunction/failure." *Intensive Care Medicine*, 22(7), 707-710.
   - *Contribution*: Evaluates six organ systems (respiratory, cardiovascular, hepatic, coagulation, renal, neurological) on a 0–4 scale (max score 24). Widely accepted as a standardized index of critical organ failure.
   - *Limitation in Allocation*: SOFA is a point-in-time organ dysfunction score, not a holistic allocation framework. It does not account for waiting duration equity or dynamic queue arbitration.

2. **SAPS-I & SAPS-II (Simplified Acute Physiology Score)**
   - *Reference*: Le Gall, J. R., et al. (1984). "A simplified acute physiology score for ICU patients." *Critical Care Medicine*, 12(11), 975-977.
   - *Contribution*: Aggregates anatomical and physiological variables measured in the first 24 hours of ICU admission to estimate hospital mortality likelihood.

3. **NEWS2 (National Early Warning Score)**
   - *Reference*: Royal College of Physicians. (2017). *National Early Warning Score (NEWS) 2: Standardising the assessment of acute-illness severity in the NHS*.
   - *Contribution*: Standardizes ward-level detection of acute physiological deterioration.

### B. Multi-Criteria Decision Analysis (MCDA) in Healthcare Triage
- *Reference*: White, D. B., et al. (2009). "Who should receive life support during a public health emergency? A framework for allocating ventilators." *Annals of Internal Medicine*, 150(2), 132-138.
- *Contribution*: Proposed multi-principle allocation frameworks combining short-term organ severity (SOFA) with long-term prognosis.
- *Limitation*: Traditional MCDA frameworks are paper-based or conceptual guidelines; they lack automated software implementations capable of real-time state tracking, auditability, and deterministic tie-breaking.

---

## 2. Comparative Matrix of Existing Systems vs CareGrid V1/V2

| Feature / Dimension | Static SOFA Score | Traditional Triage Protocol | Standard EHR Triage Module | CareGrid V2 Engine |
| :--- | :--- | :--- | :--- | :--- |
| **Organ Dysfunction Quantification** | Yes (0–24 SOFA) | Partial / Qualitative | Yes | **Yes (Derived SOFA 0-100)** |
| **Multi-Factor Weighting** | No (Single Score) | Subjective | Static | **Configurable & Normalized** |
| **Waiting Duration Equity** | No | Manual First-Come | Basic Queue | **Dynamic Wait Factor** |
| **Dynamic Re-Arbitration** | No | Manual Shift Triage | Periodic Refresh | **Real-Time Event Engine** |
| **Deterministic Tie-Breaking** | No (Equal Scores Unresolved) | Clinician Discretion | Arbitrary Sort | **Configurable 4-Tier Hierarchy** |
| **Auditability & Provenance** | Low | Paper Log | Basic DB Log | **Structured Event Audit Trail** |
| **Deterministic Explainability** | None | Verbal | None | **Auto-Generated Natural Text** |

---

## 3. Key References

1. Vincent, J. L., Moreno, R., Takala, J., Willatts, S., De Mendonça, A., Bruining, H., ... & Thijs, L. G. (1996). The SOFA (Sepsis-related Organ Failure Assessment) score to describe organ dysfunction/failure. *Intensive Care Medicine*, 22(7), 707-710.
2. Le Gall, J. R., Loirat, P., Alperovitch, A., Glaser, P., Granthil, C., Mathieu, D., ... & Villers, D. (1984). A simplified acute physiology score for ICU patients. *Critical Care Medicine*, 12(11), 975-977.
3. White, D. B., Katz, M. H., Luce, J. M., & Lo, B. (2009). Who should receive life support during a public health emergency? A framework for allocating ventilators. *Annals of Internal Medicine*, 150(2), 132-138.
4. Christian, M. D., Hawryluck, L., Wax, R. S., Cook, T., Lazar, N. M., Herridge, M. S., ... & Lapinsky, S. E. (2006). Development of a triage protocol for patients with influenza during a pandemic. *CMAJ*, 175(11), 1377-1381.
