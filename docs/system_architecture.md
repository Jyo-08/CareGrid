# CareGrid V2 — System Architecture & Data Flow

## 1. System Component Overview

The CareGrid V2 system architecture is structured into modular Python components:

```text
                               DATA SOURCES
                                    |
                    +---------------+---------------+
                    |                               |
             X_train_2025.csv                  patients.csv
            (3,600 ICU Records)            (1,000 Demographics)
                    |                               |
                    +---------------+---------------+
                                    |
                               DATA LOADER
                          (src/data_loader.py)
                                    |
                             PATIENT MODEL
                         (src/patient_model.py)
                                    |
                            PROVENANCE ENGINE
                          (src/provenance.py)
                                    |
                            PRIORITY ENGINE
                        (src/priority_engine.py)
                                    |
             +----------------------+----------------------+
             |                                             |
     FACTOR CONTRIBUTIONS                         TIE-BREAK ENGINE
     (Sev, Surv, Wait)                         (4-Tier Deterministic)
             |                                             |
             +----------------------+----------------------+
                                    |
                            ARBITRATION ENGINE
                           (src/event_engine.py)
                                    |
            +-----------------------+-----------------------+
            |                       |                       |
    SIMULATION ENGINE           EXPLAINABILITY          AUDIT LOGGER
(src/simulation_engine.py)    (Deterministic Text)   (src/audit_logger.py)
            |                       |                       |
            +-----------------------+-----------------------+
                                    |
                             REST API SERVER
                            (src/server.py)
                                    |
                           CAREGRID V2 DASHBOARD
                            (static/ index/app/css)
```

---

## 2. Component Descriptions

1. **DataLoader (`src/data_loader.py`)**
   - Ingests raw `X_train_2025.csv` and `patients.csv`.
   - Handles missing parameters, NaN values, and missing CSV checks.

2. **Patient Model (`src/patient_model.py`)**
   - Represents the patient entity, raw clinical parameters, SOFA-derived severity calculation, factor contributions, and rank delta history.

3. **PriorityEngine (`src/priority_engine.py`)**
   - Computes normalized factor contributions and total priority score.
   - Executes 4-tier deterministic tie-breaking hierarchy for near-tie scores ($\le 0.50$).
   - Generates deterministic explainability strings.

4. **EventEngine (`src/event_engine.py`)**
   - Handles real state transitions (`NEW_PATIENT`, `SEVERITY_UPDATED`, `WAITING_TIME_ADVANCED`, `PATIENT_DISCHARGED`, `ICU_BED_AVAILABLE`).
   - Computes Before/After queue state deltas (moved up, moved down).

5. **SimulationEngine (`src/simulation_engine.py`)**
   - Provides scenario triggers (`new_critical_patient`, `severity_spike`, `advance_time`, `discharge_top`, `reset`) operating directly on real application state.

6. **AuditLogger (`src/audit_logger.py`)**
   - Maintains structured event logs for system transparency and auditing.

7. **REST Server & Dashboard (`src/server.py` & `static/`)**
   - Pure Python HTTP server serving JSON REST APIs and CareGrid V2 dashboard interface.
