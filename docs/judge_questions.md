# CareGrid V2 — Judge Questions & Comprehensive Evidence-Based Answers

### Q1: Why did you choose SOFA for severity derivation?
**Answer**: SOFA (Sequential Organ Failure Assessment) is clinically validated worldwide in critical care medicine to evaluate organ dysfunction across 6 key organ systems. We transform SOFA ($0\text{--}20$) to a normalized 0–100 score ($\text{clamp}(\text{SOFA}/20 \times 100, 0, 100$) to enable mathematical comparison with survival potential and waiting duration.

### Q2: Are the scoring weights (0.50 / 0.30 / 0.20) clinically validated?
**Answer**: No. We explicitly label these as our *proposed configurable weighting methodology*, not clinically validated universal constants. Hospital triage committees can configure weights based on institutional surge policy.

### Q3: What happens when two patients have almost the same priority score?
**Answer**: CareGrid enforces a deterministic 4-tier tie-breaking policy when score differences are within $\le 0.50$ points: Tier 1: Higher severity contribution $\rightarrow$ Tier 2: Longer waiting duration $\rightarrow$ Tier 3: Higher survival likelihood $\rightarrow$ Tier 4: Lexicographical Patient ID. It never reverts to random ordering.

### Q4: How does the system dynamically respond to a new patient arrival or severity spike?
**Answer**: CareGrid uses an event-driven arbitration engine. Ingestion of a `NEW_PATIENT` or `SEVERITY_UPDATED` event triggers instant priority score recalculation and deterministic queue re-sorting across all active records.

### Q5: How do you explain why Patient X is ranked above Patient Y?
**Answer**: CareGrid exposes exact factor contributions (`severity_contribution`, `survival_contribution`, `waiting_contribution`) and generates a deterministic explanation string detailing the score margin and contributing physiological factors.

### Q6: How are decisions audited?
**Answer**: Every state transition, score change, rank delta, and simulation event is logged in a structured `AuditLogger` containing Event ID, timestamp, event type, patient ID, previous/new values, and rank deltas.

### Q7: Which fields come from the dataset vs derived vs simulated?
**Answer**:
- `SOURCE_VALUE`: Raw physiological parameters from `X_train_2025.csv` (SOFA, SAPS-I, GCS, HR, MAP, SaO2, Creatinine, WBC) and arrival date from `patients.csv`.
- `DERIVED_VALUE`: `patient_id` (`P-{recordid}`) and SOFA-derived `severity`.
- `SIMULATED_VALUE`: Survival likelihood, waiting time minutes, and patient status (explicitly labeled to maintain transparency).

### Q8: Is this an autonomous medical decision system?
**Answer**: No. CareGrid is strictly a clinical decision-support research prototype. Final allocation authority remains with authorized clinicians.

### Q9: Where does AI fit into CareGrid V2?
**Answer**: CareGrid uses a deterministic scoring and arbitration engine for decision reliability. Generative AI is kept out of the core scoring loop to eliminate hallucination risk.

### Q10: How does CareGrid scale to a real hospital deployment?
**Answer**: The Python backend processes re-ranking across thousands of patient records in milliseconds ($<0.05\text{s}$). In production, it connects to standard EHR systems via HL7/FHIR interfaces.
