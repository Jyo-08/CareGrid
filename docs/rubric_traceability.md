# CareGrid V2 — Rubric Traceability Matrix (15 Marks)

This document explicitly maps every hackathon competition evaluation criterion to concrete artifacts and code implementations in the repository.

---

| Rubric Criterion | Max Marks | Project Artifacts & Code Evidence | Summary of Delivered Evidence |
| :--- | :---: | :--- | :--- |
| **1. Problem Understanding & Objectives** | **2** | - `docs/problem_statement.md`<br>- `README.md` Section 1 & 2<br>- `src/provenance.py` | - Clearly states ICU resource constraints, operational objectives, and input-process-output model.<br>- Mandates Clinician-in-the-loop oversight.<br>- Explicit data provenance classification. |
| **2. Literature Survey & Research Gap** | **3** | - `docs/literature_review.md`<br>- `docs/research_gap.md`<br>- `README.md` Section 3 | - Comprehensive review of SOFA (Vincent et al. 1996), SAPS-I (Le Gall 1984), NEWS2, and ventilator triage MCDA (White 2009).<br>- Articulates CareGrid's core gap: integrating organ severity + survival + wait duration equity + dynamic re-arbitration + auditability. |
| **3. Proposed Methodology & Architecture** | **3** | - `docs/methodology.md`<br>- `docs/system_architecture.md`<br>- `docs/design_decisions.md`<br>- `src/priority_engine.py` | - Detailed 16-stage Input-Process-Output methodology.<br>- SOFA severity derivation formula: $\text{clamp}(\text{SOFA}/20 \times 100, 0, 100)$.<br>- Configurable normalized 3-factor weighting.<br>- 4-Tier deterministic tie-breaking hierarchy. |
| **4. Implementation & Progress** | **3** | - Working V1/V2 Python codebase<br>- `src/event_engine.py`<br>- `src/simulation_engine.py`<br>- `src/audit_logger.py`<br>- `src/server.py`<br>- `static/` Dashboard UI | - Ingests 3,600 real records (`X_train_2025.csv` + `patients.csv`).<br>- Dynamic event-driven state transitions (`NEW_PATIENT`, `SEVERITY_UPDATED`, etc.).<br>- Real-time simulation engine.<br>- Structured event audit trail.<br>- Deterministic clinical explainability. |
| **5. Documentation Quality** | **2** | - `README.md`<br>- `docs/` folder (10 documents)<br>- System Architecture diagram<br>- Complete code docstrings | - 10 comprehensive markdown documents.<br>- Professional architectural flow diagrams.<br>- Complete data provenance disclosures. |
| **6. Team Presentation & Q&A Preparation** | **2** | - `docs/demo_script.md`<br>- `docs/judge_questions.md`<br>- `docs/validation_report.md` | - Structured 3–5 minute live presentation script.<br>- 10 detailed judge Q&A responses.<br>- Real dataset sanity and verification metrics report. |
| **TOTAL** | **15** | | **Full Rubric-Maximizing Coverage** |
