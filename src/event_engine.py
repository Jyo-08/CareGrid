"""
CareGrid V2 - Event & Arbitration Engine Module
Processes real state transitions, dynamic re-ranking, Before/After rank comparison,
and records audit events.
"""

from typing import List, Dict, Any, Optional
from src.patient_model import Patient
from src.priority_engine import PriorityEngine
from src.audit_logger import AuditLogger


class EventEngine:
    def __init__(self, priority_engine: PriorityEngine, audit_logger: AuditLogger):
        self.engine = priority_engine
        self.audit_logger = audit_logger
        self.patients_map: Dict[str, Patient] = {}
        self.total_beds: int = 50
        self.occupied_beds: int = 42

    def load_patients(self, patients: List[Patient]):
        """Sets active patient population and ranks them."""
        self.patients_map = {p.patient_id: p for p in patients}
        self.re_rank_all(trigger_reason="INITIAL_LOAD")

    def get_all_patients(self) -> List[Patient]:
        pass

    def get_ranked_patients(self, limit: Optional[int] = None) -> List[Patient]:
        patient_list = list(self.patients_map.values())
        ranked = self.engine.rank_patients(patient_list)
        return ranked[:limit] if limit else ranked

    def re_rank_all(self, trigger_reason: str = "STATE_CHANGE") -> List[Patient]:
        patient_list = list(self.patients_map.values())
        return self.engine.rank_patients(patient_list)

    def process_event(
        self,
        event_type: str,
        patient_id: Optional[str] = None,
        new_value: Any = None,
        reason: str = "",
        extra_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Processes a dynamic event, updates application state, recalculates priority scores,
        computes Before/After rank changes, and records an Audit log.
        """
        before_list = self.get_ranked_patients()
        before_ranks = {p.patient_id: p.rank for p in before_list}
        before_scores = {p.patient_id: p.priority_score for p in before_list}

        target_patient = self.patients_map.get(patient_id) if patient_id else None
        prev_val = None
        prev_rank = before_ranks.get(patient_id) if patient_id else None

        # Execute State Transition
        if event_type == "NEW_PATIENT":
            if isinstance(new_value, Patient):
                new_p = new_value
            elif isinstance(new_value, dict):
                rec_id = str(new_value.get("record_id", "99999"))
                new_p = Patient(
                    record_id=rec_id,
                    sofa_score=float(new_value.get("sofa_score", 12.0)),
                    survival_likelihood=float(new_value.get("survival_likelihood", 85.0)),
                    waiting_time_minutes=int(new_value.get("waiting_time_minutes", 10)),
                    arrival_time="2025-08-17",
                    patient_status="Waiting",
                    name=new_value.get("name", f"Emergency Patient {rec_id}")
                )
            else:
                raise ValueError("Invalid new_value for NEW_PATIENT event")
            
            patient_id = new_p.patient_id
            self.patients_map[patient_id] = new_p
            target_patient = new_p
            prev_val = None
            reason = reason or f"New critical patient {patient_id} admitted to queue"

        elif event_type == "SEVERITY_UPDATED":
            if not target_patient:
                raise KeyError(f"Patient {patient_id} not found")
            prev_val = target_patient.severity
            new_sofa = float(new_value)
            target_patient.update_severity(new_sofa, event_trigger=event_type)
            reason = reason or f"Patient {patient_id} SOFA updated to {new_sofa} (Severity: {target_patient.severity})"

        elif event_type == "SURVIVAL_LIKELIHOOD_UPDATED":
            if not target_patient:
                raise KeyError(f"Patient {patient_id} not found")
            prev_val = target_patient.survival_likelihood
            target_patient.survival_likelihood = float(new_value)
            target_patient.last_event_trigger = event_type
            reason = reason or f"Patient {patient_id} survival likelihood updated to {new_value}%"

        elif event_type == "WAITING_TIME_ADVANCED":
            advance_mins = int(new_value or 15)
            if target_patient:
                prev_val = target_patient.waiting_time_minutes
                target_patient.waiting_time_minutes += advance_mins
                target_patient.last_event_trigger = event_type
                reason = reason or f"Patient {patient_id} waiting time advanced by {advance_mins} mins"
            else:
                for p in self.patients_map.values():
                    if p.patient_status == "Waiting":
                        p.waiting_time_minutes += advance_mins
                reason = reason or f"Global waiting time advanced by {advance_mins} mins"

        elif event_type == "PATIENT_DISCHARGED":
            if not target_patient:
                raise KeyError(f"Patient {patient_id} not found")
            prev_val = target_patient.patient_status
            target_patient.patient_status = "Discharged"
            target_patient.last_event_trigger = event_type
            if self.occupied_beds > 0:
                self.occupied_beds -= 1
            reason = reason or f"Patient {patient_id} discharged from ICU"

        elif event_type == "ICU_BED_AVAILABLE":
            prev_val = self.occupied_beds
            if self.occupied_beds > 0:
                self.occupied_beds -= 1
            reason = reason or f"ICU Bed released. Available beds: {self.total_beds - self.occupied_beds}"

        elif event_type == "ICU_BED_OCCUPIED":
            prev_val = self.occupied_beds
            if self.occupied_beds < self.total_beds:
                self.occupied_beds += 1
            reason = reason or f"ICU Bed allocated. Available beds: {self.total_beds - self.occupied_beds}"

        else:
            raise ValueError(f"Unknown event type: {event_type}")

        # Recalculate priority scores and re-rank
        after_list = self.re_rank_all(trigger_reason=event_type)
        after_ranks = {p.patient_id: p.rank for p in after_list}
        after_scores = {p.patient_id: p.priority_score for p in after_list}

        new_rank = after_ranks.get(patient_id) if patient_id else None

        # Compute rank movements (moved up, moved down, unchanged)
        moved_up = []
        moved_down = []
        unchanged = []

        for p_id, old_r in before_ranks.items():
            new_r = after_ranks.get(p_id)
            if new_r is None:
                continue
            delta = old_r - new_r  # Positive delta means moved UP in rank (#5 -> #2 = +3)
            p_obj = self.patients_map[p_id]
            info = {
                "patient_id": p_id,
                "previous_rank": old_r,
                "new_rank": new_r,
                "rank_delta": delta,
                "previous_score": before_scores.get(p_id),
                "new_score": after_scores.get(p_id)
            }
            if delta > 0:
                moved_up.append(info)
            elif delta < 0:
                moved_down.append(info)
            else:
                unchanged.append(info)

        impact_summary = (
            f"Rank Shift: #{prev_rank} -> #{new_rank} (Delta: {prev_rank - new_rank if (prev_rank and new_rank) else 0}). "
            f"Population shifts: {len(moved_up)} moved up, {len(moved_down)} moved down."
        ) if patient_id else f"Population shifts: {len(moved_up)} moved up, {len(moved_down)} moved down."

        audit_evt = self.audit_logger.log_event(
            event_type=event_type,
            patient_id=patient_id,
            previous_value=prev_val,
            new_value=new_value.to_dict() if hasattr(new_value, "to_dict") else new_value,
            previous_rank=prev_rank,
            new_rank=new_rank,
            reason=reason,
            source="EVENT_ENGINE",
            ranking_impact_summary=impact_summary
        )

        return {
            "status": "success",
            "audit_event": audit_evt.to_dict(),
            "target_patient": target_patient.to_dict() if target_patient else None,
            "moved_up": moved_up[:10],
            "moved_down": moved_down[:10],
            "top_10_after": [p.to_dict() for p in after_list[:10]]
        }
