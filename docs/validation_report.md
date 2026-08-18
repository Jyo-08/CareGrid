# CareGrid V2 — Data Sanity & Validation Report

## 1. Data Ingestion & Sanity Metrics (Real Dataset Observation)

Metrics generated from executing CareGrid V2 on `data/raw/X_train_2025.csv` and `data/raw/patients.csv`:

| Metric Dimension | Value / Observation | Source Provenance |
| :--- | :--- | :--- |
| **Total Ingested Records** | 3,600 ICU patient records | `X_train_2025.csv` (`SOURCE_VALUE`) |
| **Demographic Records Joined** | 1,000 hospital patient records | `patients.csv` (`SOURCE_VALUE`) |
| **Raw SOFA Score Range** | $0.0 \text{ to } 23.0$ | `SOFA` field (`SOURCE_VALUE`) |
| **SOFA-Derived Severity Range** | $0.0 \text{ to } 100.0$ | Derived formula (`DERIVED_VALUE`) |
| **Priority Score Range** | $14.2 \text{ to } 90.7$ | Priority Engine (`DERIVED_VALUE`) |
| **Critical Severity Count** | 174 patients (Severity $\ge 70.0$) | Derived from dataset (`DERIVED_VALUE`) |
| **Waiting Patients Count** | 2,133 patients | Simulated status (`SIMULATED_VALUE`) |
| **ICU Bed Capacity** | 42 occupied / 50 total (8 available) | Simulated capacity (`SIMULATED_VALUE`) |

---

## 2. Test Suite Execution Summary

- **Total Test Cases Executed**: 20 test cases
- **Passed**: 20 (100% pass rate)
- **Failed**: 0
- **Execution Time**: ~0.20 seconds
- **Test Categories**:
  - Dataset & Provenance Integrity Tests
  - SOFA Severity Derivation & Edge Case Tests
  - Priority Scoring & Configurable Weights Tests
  - Deterministic Tie-Breaking & Near-Tie Arbitration Tests
  - Dynamic Event Engine & State Transition Tests
  - Simulation Engine & Reset Scenario Tests
  - Structured Audit Logger Tests
  - REST API & End-to-End Workflow Tests

---

## 3. Disclaimer

> [!IMPORTANT]
> **CareGrid V2 is a decision-support research prototype.**
> - All performance metrics and rankings reflect deterministic computational execution on competition datasets.
> - Final clinical allocation and patient management remain the sole responsibility of qualified medical professionals.
