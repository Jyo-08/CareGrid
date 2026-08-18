# CareGrid

## Clinical Priority Intelligence for Dynamic ICU Queue Management

CareGrid is an explainable clinical prioritization and ICU queue management system designed to support transparent, data-driven patient prioritization.

The system combines clinical severity, prognostic information, and operational waiting time into a structured priority framework while maintaining a dynamic patient queue and providing transparent reasoning behind ranking decisions.

CareGrid V6 extends the original priority engine with a six-system clinical severity decomposition, enabling the system to identify the clinical factors contributing to a patient's overall severity rather than treating severity as a single opaque value.

---

## V6 Clinical Priority Architecture

```text
                         CAREGRID
                            |
              +-------------+-------------+
              |                           |
              v                           v
      CLINICAL FACTORS             OPERATIONAL FACTOR
              |                           |
              v                           v
          SEVERITY                  WAITING TIME
              |
       +------+------+------+------+------+
       |      |      |      |      |      |
       v      v      v      v      v      v
     Neuro  Cardio  Resp   Coag   Liver  Kidney
              |
              v
       OVERALL SEVERITY
              |
              +
       LONG-TERM PROGNOSIS
              |
              v
     SURVIVAL / PROGNOSTIC
          COMPONENT
              |
              +
         WAITING TIME
              |
              v
      CAREGRID PRIORITY
            SCORE
              |
              v
           RANKING
```

The central V6 innovation is the decomposition of clinical severity into six organ-system factors:

* Neurological
* Cardiovascular
* Respiratory
* Coagulation
* Liver
* Kidney

These factors contribute to an overall clinical severity representation, which is then integrated with the prognostic and operational components of the existing CareGrid prioritization framework.

---

## Key Features

### Dynamic Patient Prioritization

CareGrid continuously calculates patient priority using the existing deterministic priority engine.

The ranking is not statically assigned. Changes in patient state can result in recalculation of priority and queue position.

### Clinical Severity Decomposition

V6 expands clinical severity into six organ-system dimensions:

| Organ System   | Clinical Dimension                |
| -------------- | --------------------------------- |
| Neurological   | Neurological function             |
| Cardiovascular | Hemodynamic/cardiovascular status |
| Respiratory    | Respiratory function              |
| Coagulation    | Platelet/coagulation status       |
| Liver          | Hepatic function                  |
| Kidney         | Renal function                    |

Each system can be examined independently before contributing to the overall severity representation.

### Overall Severity

The six clinical dimensions are consolidated into an overall severity representation.

CareGrid can therefore provide both:

* Overall clinical severity
* Individual organ-system contributors

This makes the severity component more transparent and interpretable.

### Prognostic Component

CareGrid separates immediate clinical severity from the prognostic component.

The architecture explicitly distinguishes:

```text
Clinical Severity
        +
Long-Term Prognosis
        |
        v
Survival / Prognostic Component
```

This allows the priority framework to incorporate both current clinical condition and the existing prognostic component.

### Waiting-Time Equity

Waiting time remains a separate operational factor.

This prevents the operational dimension of queue management from being hidden inside clinical severity.

### Priority Score

The clinical and operational components are combined through the CareGrid priority engine to produce a normalized priority score.

The priority score determines the patient's position in the active queue.

### Dynamic Queue Management

The queue responds to changes in patient state.

For example:

```text
Patient State Change
        |
        v
Clinical Severity
        |
        v
Priority Score
        |
        v
Queue Recalculation
        |
        v
Updated Ranking
```

When a patient is discharged, the patient leaves the active queue and the remaining patients are re-ranked.

### Explainable Ranking

CareGrid provides structured explanations for ranking decisions.

The system can break down:

* Overall severity
* Organ-system contributors
* Prognostic component
* Waiting-time contribution
* Final priority score
* Ranking position

This enables users to understand why a patient occupies a particular position rather than relying on an unexplained ranking.

### Dynamic Attention Engine

The Attention Engine identifies operational and clinical situations requiring attention based on the current system state.

Potential signals include:

* Critical severity
* Multi-organ involvement
* Extended waiting time
* Near-tie priority scores
* Significant ranking changes
* ICU capacity pressure

Attention signals are derived from current CareGrid data rather than fixed patient-specific messages.

### What-If Clinical Simulation

CareGrid supports isolated what-if scenarios for exploring potential changes in clinical severity.

For example:

```text
Current State
    |
    v
Respiratory Severity = 40
    |
    v
What-If Scenario
    |
    v
Respiratory Severity = 85
    |
    v
Recalculate Severity
    |
    v
Recalculate Priority
    |
    v
Compare Ranking
```

Simulation operates independently from the live queue and does not modify production patient state.

### Honest Missing-Data Representation

CareGrid does not fabricate unavailable clinical information.

When the required clinical data for an organ system is unavailable, the system represents it explicitly as:

```text
DATA UNAVAILABLE
```

This is kept distinct from a normal clinical result.

---

## System Architecture

```text
Patient Dataset
      |
      v
Data Loader
      |
      v
Clinical Severity Engine
      |
      +---- Neurological
      +---- Cardiovascular
      +---- Respiratory
      +---- Coagulation
      +---- Liver
      +---- Kidney
      |
      v
Overall Severity
      |
      +---- Prognostic Component
      |
      +---- Waiting Time
      |
      v
Priority Engine
      |
      v
Ranking Engine
      |
      +---- Command Center
      +---- Patient Profile
      +---- Attention Engine
      +---- Analytics
      +---- What-If Simulation
      +---- Audit / Explainability
```

---

## Technology Stack

### Backend

* Python
* HTTP REST API
* Modular deterministic clinical and priority engines

### Frontend

* HTML
* CSS
* JavaScript
* Interactive dashboard components
* Data-driven visualizations

### Core System Components

* Patient/Data Loader
* Clinical Severity Engine
* Priority Engine
* Ranking Engine
* Attention Engine
* Simulation Engine
* Audit Logger
* CareGrid Intelligence / Explainability Layer

### Testing

* Python `unittest`
* Unit and integration testing
* API endpoint validation
* Simulation isolation testing

---

## Design Principles

### Deterministic First

The CareGrid priority engine remains the authoritative source for patient ranking.

The system does not rely on generative AI to determine priority.

### Explainability

Every major prioritization decision should be traceable to its underlying components.

### Data Integrity

CareGrid uses the available patient data and does not invent unavailable clinical measurements.

### Dynamic State

Patient rankings, dashboard metrics, attention signals, and queue composition are derived from the current system state.

### Separation of Concerns

CareGrid separates:

```text
Clinical Factors
       |
       v
Severity

Prognostic Factors
       |
       v
Survival / Prognostic Component

Operational Factors
       |
       v
Waiting Time
```

These components are then brought together by the priority engine.

### Simulation Safety

What-if scenarios operate in an isolated state and cannot modify the live patient queue.

---

## V5 to V6 Evolution

### CareGrid V5

```text
Severity
   +
Survival / Prognosis
   +
Waiting Time
   |
   v
Priority Score
   |
   v
Ranking
```

### CareGrid V6

```text
Clinical Factors
   |
   +-- Neurological
   +-- Cardiovascular
   +-- Respiratory
   +-- Coagulation
   +-- Liver
   +-- Kidney
   |
   v
Overall Severity
   +
Long-Term Prognosis
   |
   v
Survival / Prognostic Component
   +
Waiting Time
   |
   v
CareGrid Priority Score
   |
   v
Ranking
```

V6 therefore moves CareGrid from a primarily aggregate severity model toward a more granular clinical-factor architecture while preserving the existing prioritization foundation.

---

## Project Objective

CareGrid aims to make ICU prioritization more:

* Transparent
* Explainable
* Dynamic
* Data-driven
* Clinically structured
* Operationally aware

The goal is not to replace clinical professionals or make autonomous treatment decisions. CareGrid is designed as a decision-support and prioritization system whose calculations and assumptions can be inspected and understood.

---

## Current Innovation

The core V6 innovation is **Clinical Factor Decomposition**.

Instead of treating severity as a single value:

```text
Severity
```

CareGrid exposes the underlying clinical structure:

```text
Neurological
Cardiovascular
Respiratory
Coagulation
Liver
Kidney
        |
        v
Overall Severity
```

This clinical layer is then connected to prognosis and operational waiting time to produce the final CareGrid Priority Score and ranking.

---

## Project Status

**CareGrid V6 — Clinical Severity Intelligence**

The V6 architecture builds upon the working V5 prioritization system and introduces organ-system clinical decomposition, dynamic clinical reasoning, explainable ranking, and isolated what-if analysis.

> CareGrid is a research and decision-support prototype. Its scoring framework should not be interpreted as a clinically validated protocol or used as a substitute for qualified medical judgment.
