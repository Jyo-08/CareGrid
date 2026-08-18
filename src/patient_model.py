"""
CareGrid V2 - Patient Data Model
Defines the core Patient entity, SOFA-based severity derivation, factor contributions,
and rank/score change history for explainability and auditability.
"""

from typing import Dict, Any, Optional
from src.provenance import ProvenanceType, FieldProvenance


def clamp(val: float, min_val: float = 0.0, max_val: float = 100.0) -> float:
    """Clamps a numerical value within [min_val, max_val]."""
    if val is None:
        return min_val
    try:
        f_val = float(val)
        return max(min_val, min(max_val, f_val))
    except (ValueError, TypeError):
        return min_val


def calculate_derived_severity(sofa_score: Optional[float]) -> float:
    """
    Derives normalized severity (0-100) from SOFA score using formula:
    severity = clamp(SOFA / 20.0 * 100.0, 0, 100)
    """
    if sofa_score is None:
        return 0.0
    try:
        sofa_val = float(sofa_score)
        if sofa_val < 0:
            sofa_val = 0.0
        return clamp((sofa_val / 20.0) * 100.0, 0.0, 100.0)
    except (ValueError, TypeError):
        return 0.0


class Patient:
    def __init__(
        self,
        record_id: str,
        sofa_score: Optional[float] = 0.0,
        survival_likelihood: Optional[float] = 75.0,
        waiting_time_minutes: int = 30,
        arrival_time: str = "2025-03-16",
        patient_status: str = "Waiting",
        name: str = "Unknown Patient",
        age: Optional[float] = None,
        service: str = "ICU",
        raw_clinical_params: Optional[Dict[str, Any]] = None
    ):
        self.record_id = str(record_id)
        self.patient_id = f"P-{self.record_id}" if not str(self.record_id).startswith("P-") else str(self.record_id)
        self.name = name
        self.age = age
        self.service = service
        self.sofa_score = float(sofa_score) if sofa_score is not None else 0.0

        # Formula: severity = clamp(SOFA / 20.0 * 100.0, 0, 100)
        self.severity = round(calculate_derived_severity(self.sofa_score), 2)
        self.survival_likelihood = round(clamp(survival_likelihood, 0.0, 100.0), 2)
        self.waiting_time_minutes = max(0, int(waiting_time_minutes or 0))
        self.arrival_time = arrival_time or "2025-01-01"
        self.patient_status = patient_status or "Waiting"
        self.raw_clinical_params = raw_clinical_params or {}

        # Scoring & Factor Contributions
        self.priority_score: float = 0.0
        self.severity_contribution: float = 0.0
        self.survival_contribution: float = 0.0
        self.waiting_contribution: float = 0.0

        # Ranking & History Tracking for Explainability
        self.rank: int = 0
        self.previous_rank: Optional[int] = None
        self.rank_delta: int = 0
        self.previous_score: Optional[float] = None
        self.score_delta: float = 0.0
        self.last_event_trigger: str = "INITIAL_INGESTION"
        self.tie_broken: bool = False
        self.tie_break_rule: Optional[str] = None

        # Provenance tracking dictionary
        self.provenance: Dict[str, FieldProvenance] = {
            "patient_id": FieldProvenance(
                value=self.patient_id,
                provenance_type=ProvenanceType.DERIVED_VALUE,
                source_field="recordid",
                calculation="Prefix 'P-' + recordid from X_train_2025.csv"
            ),
            "sofa_score": FieldProvenance(
                value=self.sofa_score,
                provenance_type=ProvenanceType.SOURCE_VALUE,
                source_field="SOFA",
                calculation="Direct from X_train_2025.csv"
            ),
            "severity": FieldProvenance(
                value=self.severity,
                provenance_type=ProvenanceType.DERIVED_VALUE,
                source_field="SOFA",
                calculation="clamp(SOFA / 20.0 * 100.0, 0, 100)"
            ),
            "arrival_time": FieldProvenance(
                value=self.arrival_time,
                provenance_type=ProvenanceType.SOURCE_VALUE,
                source_field="arrival_date",
                calculation="Direct from patients.csv"
            ),
            "survival_likelihood": FieldProvenance(
                value=self.survival_likelihood,
                provenance_type=ProvenanceType.SIMULATED_VALUE,
                source_field=None,
                calculation="Simulated V1/V2 score (not clinical ground truth)"
            ),
            "waiting_time_minutes": FieldProvenance(
                value=self.waiting_time_minutes,
                provenance_type=ProvenanceType.SIMULATED_VALUE,
                source_field=None,
                calculation="Simulated V1/V2 wait time (not clinical ground truth)"
            ),
            "patient_status": FieldProvenance(
                value=self.patient_status,
                provenance_type=ProvenanceType.SIMULATED_VALUE,
                source_field=None,
                calculation="Simulated V1/V2 status (not clinical ground truth)"
            )
        }

    def update_severity(self, new_sofa: float, event_trigger: str = "SEVERITY_UPDATED"):
        """Updates SOFA score, recalculates derived severity, and tracks change history."""
        self.sofa_score = float(new_sofa)
        self.severity = round(calculate_derived_severity(self.sofa_score), 2)
        self.provenance["sofa_score"].value = self.sofa_score
        self.provenance["severity"].value = self.severity
        self.last_event_trigger = event_trigger

    def get_clinical_decomposition(self) -> Dict[str, Any]:
        """Evaluates V6 6-organ system clinical factor decomposition."""
        from src.clinical_engine import ClinicalEngine
        engine = ClinicalEngine()
        return engine.evaluate_patient_clinical_factors(self)

    def to_dict(self) -> Dict[str, Any]:
        """Returns JSON-serializable dictionary representation of patient."""
        return {
            "record_id": self.record_id,
            "patient_id": self.patient_id,
            "name": self.name,
            "age": self.age,
            "service": self.service,
            "sofa_score": self.sofa_score,
            "severity": self.severity,
            "survival_likelihood": self.survival_likelihood,
            "waiting_time_minutes": self.waiting_time_minutes,
            "arrival_time": self.arrival_time,
            "patient_status": self.patient_status,
            "priority_score": round(self.priority_score, 2),
            "severity_contribution": round(self.severity_contribution, 2),
            "survival_contribution": round(self.survival_contribution, 2),
            "waiting_contribution": round(self.waiting_contribution, 2),
            "rank": self.rank,
            "previous_rank": self.previous_rank,
            "rank_delta": self.rank_delta,
            "previous_score": round(self.previous_score, 2) if self.previous_score is not None else None,
            "score_delta": round(self.score_delta, 2),
            "last_event_trigger": self.last_event_trigger,
            "tie_broken": self.tie_broken,
            "tie_break_rule": self.tie_break_rule,
            "raw_clinical_params": self.raw_clinical_params,
            "clinical_factors": self.get_clinical_decomposition(),
            "provenance": {k: v.to_dict() for k, v in self.provenance.items()}
        }
