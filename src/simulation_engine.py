"""
CareGrid V2 - Simulation Engine Module
Runs real interactive simulation scenarios through the real CareGrid Priority and Event Engine.
Supports reset, critical additions, severity spikes, wait time advances, and bed availability toggles.
"""

from typing import Dict, Any, List
from src.data_loader import DataLoader
from src.patient_model import Patient
from src.event_engine import EventEngine


class SimulationEngine:
    def __init__(self, data_loader: DataLoader, event_engine: EventEngine):
        self.data_loader = data_loader
        self.event_engine = event_engine
        self._counter = 100

    def seed_initial_state(self):
        """Loads dataset and seeds initial patient population."""
        patients = self.data_loader.load_patients()
        self.event_engine.load_patients(patients)

    def reset_simulation(self) -> Dict[str, Any]:
        """Resets simulation state back to original raw dataset state."""
        self.event_engine.audit_logger.clear()
        self.event_engine.total_beds = 50
        self.event_engine.occupied_beds = 42
        self.seed_initial_state()
        return {
            "status": "success",
            "message": "Simulation state reset to original dataset baseline",
            "total_patients": len(self.event_engine.patients_map)
        }

    def simulate_new_critical_patient(self) -> Dict[str, Any]:
        """Simulates arrival of a new high-severity emergency patient (SOFA 18)."""
        self._counter += 1
        rec_id = f"99{self._counter}"
        patient = Patient(
            record_id=rec_id,
            sofa_score=18.0,            # Severity = 90.0
            survival_likelihood=92.0,   # High survival potential
            waiting_time_minutes=5,
            arrival_time="2025-08-17",
            patient_status="Waiting",
            name=f"EMERGENCY ARRIVAL P-{rec_id}"
        )
        result = self.event_engine.process_event(
            event_type="NEW_PATIENT",
            new_value=patient,
            reason="EMERGENCY STAT: Incoming polytrauma patient requiring immediate ICU bed arbitration"
        )
        return result

    def simulate_patient_severity_spike(self, patient_id: str = "P-137517") -> Dict[str, Any]:
        """Simulates sudden clinical deterioration (SOFA score spike to 19)."""
        result = self.event_engine.process_event(
            event_type="SEVERITY_UPDATED",
            patient_id=patient_id,
            new_value=19.0,
            reason=f"CRITICAL ALERT: Rapid septic deterioration in patient {patient_id} (SOFA spiked to 19)"
        )
        return result

    def simulate_advance_time(self, minutes: int = 30) -> Dict[str, Any]:
        """Advances waiting duration across all pending patients."""
        result = self.event_engine.process_event(
            event_type="WAITING_TIME_ADVANCED",
            new_value=minutes,
            reason=f"SIMULATION: Advanced waiting queue clock by +{minutes} minutes"
        )
        return result

    def simulate_discharge_top_patient(self) -> Dict[str, Any]:
        ranked = self.event_engine.get_ranked_patients()
        if not ranked:
            return {"status": "error", "message": "Queue is empty"}
        top_patient = ranked[0]
        result = self.event_engine.process_event(
            event_type="PATIENT_DISCHARGED",
            patient_id=top_patient.patient_id,
            reason=f"ICU Allocation/Discharge completed for top patient {top_patient.patient_id}"
        )
        return result
