"""
CareGrid V2 - Simulation Engine Module
Runs real interactive simulation scenarios through the real CareGrid Priority and Event Engine.
Supports reset, critical additions, severity spikes, wait time advances, and bed availability toggles.
"""

from typing import Dict, Any, List, Optional
from src.data_loader import DataLoader
from src.patient_model import Patient
from src.event_engine import EventEngine
from src.priority_engine import PriorityEngine


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


import copy

class WhatIfSimulationEngine:
    """
    CareGrid V5.0 State-Isolated What-If Engine.
    Executes hypothetical multi-factor scenario testing on deep-cloned sandbox copies.
    REUSES existing PriorityEngine & rankingComparator logic without mutating live state.
    """
    def __init__(self, priority_engine: PriorityEngine):
        self.priority_engine = priority_engine

    def run_what_if_scenario(
        self,
        live_patients: List[Patient],
        patient_id: str,
        scenario_changes: Dict[str, Any],
        capacity_change: Optional[int] = 0
    ) -> Dict[str, Any]:
        """
        Runs a hypothetical What-If scenario on a deep copy of live patient data.
        NEVER modifies live_patients or live application state.
        Reuses the exact existing CareGrid PriorityEngine.
        """
        if not live_patients:
            return {"status": "error", "message": "Live patient queue is empty"}

        # 1. Rank live queue to establish BEFORE baseline
        live_queue = self.priority_engine.rank_patients([copy.deepcopy(p) for p in live_patients])
        before_ranks = {p.patient_id: p.rank for p in live_queue}
        before_scores = {p.patient_id: p.priority_score for p in live_queue}

        target_live = next((p for p in live_queue if p.patient_id == patient_id), None)
        if not target_live:
            return {"status": "error", "message": f"Patient {patient_id} not found in live queue"}

        # Capture BEFORE state snapshot
        before_snapshot = {
            "patient_id": target_live.patient_id,
            "rank": target_live.rank,
            "priority_score": target_live.priority_score,
            "sofa_score": target_live.sofa_score,
            "severity": target_live.severity,
            "survival_likelihood": target_live.survival_likelihood,
            "waiting_time_minutes": target_live.waiting_time_minutes,
            "severity_contribution": target_live.severity_contribution,
            "survival_contribution": target_live.survival_contribution,
            "waiting_contribution": target_live.waiting_contribution
        }

        # 2. Deep clone live queue to construct SIMULATION STATE
        sim_queue = [copy.deepcopy(p) for p in live_patients]
        target_sim = next((p for p in sim_queue if p.patient_id == patient_id), None)

        event_details = []

        # Apply scenario factor changes safely
        if "waiting_time_minutes" in scenario_changes and scenario_changes["waiting_time_minutes"] is not None:
            old_wait = target_sim.waiting_time_minutes
            new_wait = max(0, int(scenario_changes["waiting_time_minutes"]))
            target_sim.waiting_time_minutes = new_wait
            diff = new_wait - old_wait
            event_details.append({
                "factor": "Waiting Time",
                "before": f"{old_wait} min",
                "after": f"{new_wait} min",
                "change": f"{'+' if diff >= 0 else ''}{diff} min"
            })

        if "sofa_score" in scenario_changes and scenario_changes["sofa_score"] is not None:
            old_sofa = target_sim.sofa_score
            new_sofa = float(scenario_changes["sofa_score"])
            target_sim.update_severity(new_sofa, event_trigger="SIMULATED_SOFA_UPDATE")
            diff = round(new_sofa - old_sofa, 1)
            event_details.append({
                "factor": "SOFA Severity",
                "before": f"SOFA {old_sofa:.1f} (Sev {before_snapshot['severity']})",
                "after": f"SOFA {new_sofa:.1f} (Sev {target_sim.severity})",
                "change": f"{'+' if diff >= 0 else ''}{diff} SOFA pts"
            })

        if "survival_likelihood" in scenario_changes and scenario_changes["survival_likelihood"] is not None:
            old_surv = target_sim.survival_likelihood
            new_surv = max(0.0, min(100.0, float(scenario_changes["survival_likelihood"])))
            target_sim.survival_likelihood = round(new_surv, 2)
            diff = round(new_surv - old_surv, 1)
            event_details.append({
                "factor": "Survival Likelihood",
                "before": f"{old_surv:.1f}%",
                "after": f"{new_surv:.1f}%",
                "change": f"{'+' if diff >= 0 else ''}{diff}%"
            })

        # Handle V6 Organ-System Severity Overrides
        if "organ_overrides" in scenario_changes and scenario_changes["organ_overrides"]:
            from src.clinical_engine import ClinicalEngine
            c_engine = ClinicalEngine()
            organ_overrides = scenario_changes["organ_overrides"]
            old_decomp = target_sim.get_clinical_decomposition()
            eval_res = c_engine.evaluate_patient_clinical_factors(target_sim, organ_overrides=organ_overrides)
            new_overall = eval_res["overall_severity"]["score"]
            target_sim.severity = new_overall
            
            for organ_key, new_val in organ_overrides.items():
                old_val = old_decomp["clinical_factors"].get(organ_key, {}).get("severity", 0.0)
                diff = round(float(new_val) - float(old_val), 1)
                event_details.append({
                    "factor": f"{organ_key.capitalize()} Organ Severity",
                    "before": f"{old_val:.1f}/100",
                    "after": f"{float(new_val):.1f}/100",
                    "change": f"{'+' if diff >= 0 else ''}{diff} pts (Overall Sev -> {new_overall:.1f})"
                })

        # 3. Recalculate priority scores & re-rank using EXISTING PriorityEngine
        sim_ranked = self.priority_engine.rank_patients(sim_queue)
        after_ranks = {p.patient_id: p.rank for p in sim_ranked}
        after_scores = {p.patient_id: p.priority_score for p in sim_ranked}

        target_after = next((p for p in sim_ranked if p.patient_id == patient_id), None)

        # Capture AFTER state snapshot
        after_snapshot = {
            "patient_id": target_after.patient_id,
            "rank": target_after.rank,
            "priority_score": target_after.priority_score,
            "sofa_score": target_after.sofa_score,
            "severity": target_after.severity,
            "survival_likelihood": target_after.survival_likelihood,
            "waiting_time_minutes": target_after.waiting_time_minutes,
            "severity_contribution": target_after.severity_contribution,
            "survival_contribution": target_after.survival_contribution,
            "waiting_contribution": target_after.waiting_contribution
        }

        # 4. Compute deltas & rank shifts
        score_delta = round(after_snapshot["priority_score"] - before_snapshot["priority_score"], 2)
        rank_delta = before_snapshot["rank"] - after_snapshot["rank"]  # Positive means moved UP in rank (#3 -> #1 = +2)

        factor_deltas = {
            "severity_contribution": round(after_snapshot["severity_contribution"] - before_snapshot["severity_contribution"], 2),
            "survival_contribution": round(after_snapshot["survival_contribution"] - before_snapshot["survival_contribution"], 2),
            "waiting_contribution": round(after_snapshot["waiting_contribution"] - before_snapshot["waiting_contribution"], 2)
        }

        # Determine dominant contribution driver
        dominant_factor = max(factor_deltas.items(), key=lambda x: abs(x[1]))
        driver_name = {
            "severity_contribution": "Severity (SOFA) contribution",
            "survival_contribution": "Survival potential contribution",
            "waiting_contribution": "Waiting duration equity contribution"
        }[dominant_factor[0]]

        # Affected patient rank shifts across full queue
        affected_patients = []
        for p_id, b_r in before_ranks.items():
            a_r = after_ranks.get(p_id)
            if a_r and b_r != a_r:
                r_diff = b_r - a_r
                affected_patients.append({
                    "patient_id": p_id,
                    "before_rank": b_r,
                    "after_rank": a_r,
                    "rank_shift": f"#{b_r} -> #{a_r} ({'UP ' + str(r_diff) if r_diff > 0 else 'DOWN ' + str(abs(r_diff))})",
                    "priority_score": after_scores.get(p_id)
                })

        affected_patients.sort(key=lambda x: x["after_rank"])

        # Grounded deterministic explanation (Strictly NO emojis)
        if rank_delta > 0:
            rank_text = f"moved UP by {rank_delta} position(s) from Rank #{before_snapshot['rank']} to Rank #{after_snapshot['rank']}"
        elif rank_delta < 0:
            rank_text = f"moved DOWN by {abs(rank_delta)} position(s) from Rank #{before_snapshot['rank']} to Rank #{after_snapshot['rank']}"
        else:
            rank_text = f"remained unchanged at Rank #{before_snapshot['rank']}"

        explanation_text = (
            f"WHAT-IF SIMULATION SUMMARY: Under the tested scenario, Patient {patient_id}'s priority score changed "
            f"from {before_snapshot['priority_score']:.1f} to {after_snapshot['priority_score']:.1f} ({'+' if score_delta >= 0 else ''}{score_delta:.1f} pts). "
            f"Consequently, Patient {patient_id} {rank_text}. The primary driver of this shift was the {driver_name} "
            f"({'+' if dominant_factor[1] >= 0 else ''}{dominant_factor[1]:.1f} pts contribution delta). "
            f"Live CareGrid state and production queue remain 100% unchanged."
        )

        return {
            "status": "success",
            "is_simulated": True,
            "patient_id": patient_id,
            "before_state": before_snapshot,
            "event_details": event_details,
            "after_state": after_snapshot,
            "impact_summary": {
                "score_delta": score_delta,
                "rank_delta": rank_delta,
                "factor_deltas": factor_deltas,
                "primary_driver": driver_name,
                "dominant_delta": dominant_factor[1]
            },
            "affected_rank_shifts": affected_patients[:10],
            "deterministic_explanation": explanation_text,
            "source": "CareGrid Priority Engine (Isolated Simulation Copy)"
        }
