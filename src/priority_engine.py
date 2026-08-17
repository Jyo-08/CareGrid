"""
CareGrid V2 - Priority & Tie-Breaking Engine Module
Calculates deterministic ICU priority scores, factor contributions, near-tie detection,
configurable deterministic tie-breaking, and deterministic explainability.
"""

from typing import List, Dict, Any, Optional, Tuple
from src.patient_model import Patient, clamp


class PriorityEngine:
    def __init__(
        self,
        weight_severity: float = 0.50,
        weight_survival: float = 0.30,
        weight_waiting: float = 0.20,
        near_tie_threshold: float = 0.50
    ):
        self.near_tie_threshold = near_tie_threshold
        self.set_weights(weight_severity, weight_survival, weight_waiting)

    def set_weights(self, weight_severity: float, weight_survival: float, weight_waiting: float):
        """Sets engine weighting parameters (normalized to sum to 1.0)."""
        total = weight_severity + weight_survival + weight_waiting
        if total <= 0:
            total = 1.0
        self.weight_severity = round(weight_severity / total, 4)
        self.weight_survival = round(weight_survival / total, 4)
        self.weight_waiting = round(weight_waiting / total, 4)

    def get_weights(self) -> Dict[str, float]:
        return {
            "weight_severity": self.weight_severity,
            "weight_survival": self.weight_survival,
            "weight_waiting": self.weight_waiting
        }

    def normalize_waiting_time(self, waiting_time_minutes: int) -> float:
        """
        Normalizes waiting time in minutes to a 0-100 scale.
        Assumes 120 minutes (2 hours) corresponds to max 100 points contribution.
        """
        if waiting_time_minutes is None:
            return 0.0
        return clamp((float(waiting_time_minutes) / 120.0) * 100.0, 0.0, 100.0)

    def calculate_priority_score(self, patient: Patient) -> float:
        """
        Calculates deterministic priority score (0.0 to 100.0) and individual factor contributions:
        Score = (Severity * W_sev) + (Survival * W_surv) + (NormalizedWait * W_wait)
        """
        norm_severity = clamp(patient.severity, 0.0, 100.0)
        norm_survival = clamp(patient.survival_likelihood, 0.0, 100.0)
        norm_wait = self.normalize_waiting_time(patient.waiting_time_minutes)

        patient.severity_contribution = round(norm_severity * self.weight_severity, 2)
        patient.survival_contribution = round(norm_survival * self.weight_survival, 2)
        patient.waiting_contribution = round(norm_wait * self.weight_waiting, 2)

        score = (
            patient.severity_contribution +
            patient.survival_contribution +
            patient.waiting_contribution
        )
        patient.priority_score = round(clamp(score, 0.0, 100.0), 2)
        return patient.priority_score

    def tie_break_comparator(self, p1: Patient, p2: Patient) -> int:
        """
        Deterministic tie-breaking comparator when |score_p1 - score_p2| <= threshold:
        Tier 1: Higher severity contribution
        Tier 2: Longer waiting time (minutes)
        Tier 3: Higher survival likelihood
        Tier 4: Lexicographical patient_id (smaller recordid string)
        Returns <0 if p1 should rank higher, >0 if p2 should rank higher, 0 if identical.
        """
        diff = abs(p1.priority_score - p2.priority_score)
        if diff <= self.near_tie_threshold:
            p1.tie_broken = True
            p2.tie_broken = True

            # Tier 1: Higher severity contribution
            if p1.severity_contribution != p2.severity_contribution:
                p1.tie_break_rule = "TIER_1_SEVERITY_CONTRIBUTION"
                p2.tie_break_rule = "TIER_1_SEVERITY_CONTRIBUTION"
                return -1 if p1.severity_contribution > p2.severity_contribution else 1

            # Tier 2: Longer waiting time
            if p1.waiting_time_minutes != p2.waiting_time_minutes:
                p1.tie_break_rule = "TIER_2_WAITING_DURATION"
                p2.tie_break_rule = "TIER_2_WAITING_DURATION"
                return -1 if p1.waiting_time_minutes > p2.waiting_time_minutes else 1

            # Tier 3: Higher survival likelihood
            if p1.survival_likelihood != p2.survival_likelihood:
                p1.tie_break_rule = "TIER_3_SURVIVAL_LIKELIHOOD"
                p2.tie_break_rule = "TIER_3_SURVIVAL_LIKELIHOOD"
                return -1 if p1.survival_likelihood > p2.survival_likelihood else 1

            # Tier 4: Lexicographical patient_id
            p1.tie_break_rule = "TIER_4_DETERMINISTIC_ID"
            p2.tie_break_rule = "TIER_4_DETERMINISTIC_ID"
            return -1 if p1.patient_id < p2.patient_id else 1

        # Standard score comparison
        return -1 if p1.priority_score > p2.priority_score else 1

    def rank_patients(self, patients: List[Patient]) -> List[Patient]:
        """
        Calculates priority scores, factor contributions, and ranks patients deterministically.
        Tracks previous_rank and rank_delta for explainability.
        """
        for patient in patients:
            self.calculate_priority_score(patient)

        # Custom sorting using functools.cmp_to_key for deterministic tie-breaker hierarchy
        import functools
        sorted_patients = sorted(
            patients,
            key=functools.cmp_to_key(self.tie_break_comparator)
        )

        # Assign ranks (#1 to #N) and calculate deltas
        for idx, patient in enumerate(sorted_patients, start=1):
            if patient.rank > 0:
                patient.previous_rank = patient.rank
                patient.rank_delta = patient.previous_rank - idx
            patient.rank = idx

        return sorted_patients

    def explain_patient(self, patient: Patient, compare_to: Optional[Patient] = None) -> Dict[str, Any]:
        """Generates a deterministic clinical explainability structure for a patient."""
        self.calculate_priority_score(patient)

        explanation_text = (
            f"Patient {patient.patient_id} is ranked #{patient.rank} with a priority score of {patient.priority_score:.1f}/100. "
            f"Contributions: Severity={patient.severity_contribution:.1f} (SOFA {patient.sofa_score}), "
            f"Survival={patient.survival_contribution:.1f} ({patient.survival_likelihood}%), "
            f"Wait={patient.waiting_contribution:.1f} ({patient.waiting_time_minutes} min)."
        )

        comparison_explanation = None
        if compare_to:
            self.calculate_priority_score(compare_to)
            score_diff = round(patient.priority_score - compare_to.priority_score, 2)
            if patient.rank < compare_to.rank:
                comparison_explanation = (
                    f"Patient {patient.patient_id} (Rank #{patient.rank}) is prioritized above {compare_to.patient_id} (Rank #{compare_to.rank}) "
                    f"due to a score margin of +{score_diff:.1f} points "
                    f"(Severity contrib: {patient.severity_contribution:.1f} vs {compare_to.severity_contribution:.1f}, "
                    f"Wait: {patient.waiting_time_minutes}m vs {compare_to.waiting_time_minutes}m)."
                )
            else:
                comparison_explanation = (
                    f"Patient {patient.patient_id} (Rank #{patient.rank}) is lower than {compare_to.patient_id} (Rank #{compare_to.rank}) "
                    f"by {abs(score_diff):.1f} points."
                )

        return {
            "patient_id": patient.patient_id,
            "rank": patient.rank,
            "priority_score": patient.priority_score,
            "factor_breakdown": {
                "severity_contribution": patient.severity_contribution,
                "survival_contribution": patient.survival_contribution,
                "waiting_contribution": patient.waiting_contribution
            },
            "explanation_text": explanation_text,
            "comparison_explanation": comparison_explanation,
            "tie_broken": patient.tie_broken,
            "tie_break_rule": patient.tie_break_rule
        }
