"""
CareGrid V2 - Audit Logger Module
Maintains an in-memory, structured audit log trail of all system events, state changes,
score recalculations, rank shifts, tie-break decisions, and simulation events.
"""

import time
import datetime
from typing import List, Dict, Any, Optional


class AuditEvent:
    def __init__(
        self,
        event_id: str,
        event_type: str,
        patient_id: Optional[str] = None,
        previous_value: Any = None,
        new_value: Any = None,
        previous_rank: Optional[int] = None,
        new_rank: Optional[int] = None,
        reason: str = "",
        source: str = "SYSTEM",
        ranking_impact_summary: str = ""
    ):
        self.event_id = event_id
        self.timestamp = datetime.datetime.utcnow().isoformat() + "Z"
        self.event_type = event_type
        self.patient_id = patient_id
        self.previous_value = previous_value
        self.new_value = new_value
        self.previous_rank = previous_rank
        self.new_rank = new_rank
        self.rank_delta = (previous_rank - new_rank) if (previous_rank and new_rank) else 0
        self.reason = reason
        self.source = source
        self.ranking_impact_summary = ranking_impact_summary

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "timestamp": self.timestamp,
            "event_type": self.event_type,
            "patient_id": self.patient_id,
            "previous_value": self.previous_value,
            "new_value": self.new_value,
            "previous_rank": self.previous_rank,
            "new_rank": self.new_rank,
            "rank_delta": self.rank_delta,
            "reason": self.reason,
            "source": self.source,
            "ranking_impact_summary": self.ranking_impact_summary
        }


class AuditLogger:
    def __init__(self):
        self.events: List[AuditEvent] = []
        self._counter = 1

    def log_event(
        self,
        event_type: str,
        patient_id: Optional[str] = None,
        previous_value: Any = None,
        new_value: Any = None,
        previous_rank: Optional[int] = None,
        new_rank: Optional[int] = None,
        reason: str = "",
        source: str = "CAREGRID_ENGINE",
        ranking_impact_summary: str = ""
    ) -> AuditEvent:
        event_id = f"EVT-{self._counter:05d}"
        self._counter += 1

        event = AuditEvent(
            event_id=event_id,
            event_type=event_type,
            patient_id=patient_id,
            previous_value=previous_value,
            new_value=new_value,
            previous_rank=previous_rank,
            new_rank=new_rank,
            reason=reason,
            source=source,
            ranking_impact_summary=ranking_impact_summary
        )
        self.events.append(event)
        return event

    def get_events(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Returns recent audit events in reverse chronological order."""
        return [e.to_dict() for e in reversed(self.events[-limit:])]

    def clear(self):
        self.events.clear()
        self._counter = 1
