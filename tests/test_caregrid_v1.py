"""
CareGrid V1 & V2 - Comprehensive Test Suite
20 unit, API, workflow, arbitration, simulation, audit, and explainability acceptance tests.
"""

import os
import sys
import unittest
import json

# Ensure project root is in sys.path
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from src.provenance import ProvenanceType
from src.patient_model import Patient, calculate_derived_severity, clamp
from src.data_loader import DataLoader, ALLOWED_RAW_FILES
from src.priority_engine import PriorityEngine
from src.audit_logger import AuditLogger
from src.event_engine import EventEngine
from src.simulation_engine import SimulationEngine
from src.intelligence_engine import IntelligenceEngine
from src.server import get_ranked_patients


class TestCareGrid(unittest.TestCase):

    def setUp(self):
        self.loader = DataLoader(base_dir=BASE_DIR)
        self.engine = PriorityEngine(weight_severity=0.50, weight_survival=0.30, weight_waiting=0.20)
        self.audit = AuditLogger()
        self.events = EventEngine(priority_engine=self.engine, audit_logger=self.audit)
        self.sim = SimulationEngine(data_loader=self.loader, event_engine=self.events)
        self.intel = IntelligenceEngine(event_engine=self.events, priority_engine=self.engine)

    # 1. Dataset test: required CSVs exist and load
    def test_01_required_csvs_exist_and_load(self):
        self.assertTrue(self.loader.verify_files_exist())
        patients = self.loader.load_patients(limit=10)
        self.assertGreater(len(patients), 0)
        self.assertIsNotNone(patients[0].patient_id)

    # 2. Dataset cleanup test: deleted CSVs do not exist and are not referenced
    def test_02_deleted_csvs_not_referenced(self):
        raw_dir = os.path.join(BASE_DIR, "data/raw")
        if os.path.exists(raw_dir):
            for fname in os.listdir(raw_dir):
                if fname.endswith(".csv"):
                    self.assertIn(fname.lower(), ALLOWED_RAW_FILES)

        prohibited_terms = ["icu beds count in india", "icu-risk-score.csv"]
        for root, _, files in os.walk(os.path.join(BASE_DIR, "src")):
            for f in files:
                if f.endswith(".py"):
                    with open(os.path.join(root, f), "r", encoding="utf-8") as file_obj:
                        content = file_obj.read().lower()
                        for term in prohibited_terms:
                            self.assertNotIn(term, content, f"Found reference to deleted file '{term}' in {f}")

    # 3. Patient model structure
    def test_03_patient_model_structure(self):
        patient = Patient(
            record_id="137517",
            sofa_score=4.0,
            survival_likelihood=80.0,
            waiting_time_minutes=45,
            arrival_time="2025-03-16",
            patient_status="Waiting"
        )
        self.assertEqual(patient.patient_id, "P-137517")
        self.assertEqual(patient.sofa_score, 4.0)
        self.assertIsInstance(patient.to_dict(), dict)

    # 4. SOFA severity derivation formula test
    def test_04_sofa_severity_derivation(self):
        self.assertAlmostEqual(calculate_derived_severity(0), 0.0)
        self.assertAlmostEqual(calculate_derived_severity(2), 10.0)
        self.assertAlmostEqual(calculate_derived_severity(10), 50.0)
        self.assertAlmostEqual(calculate_derived_severity(20), 100.0)
        self.assertAlmostEqual(calculate_derived_severity(25), 100.0)
        self.assertAlmostEqual(calculate_derived_severity(-5), 0.0)
        self.assertAlmostEqual(calculate_derived_severity(None), 0.0)

    # 5. Provenance labeling test
    def test_05_provenance_labeling(self):
        patient = Patient(record_id="1000", sofa_score=6.0)
        p_dict = patient.to_dict()["provenance"]

        self.assertEqual(p_dict["sofa_score"]["provenance"], ProvenanceType.SOURCE_VALUE)
        self.assertEqual(p_dict["severity"]["provenance"], ProvenanceType.DERIVED_VALUE)
        self.assertEqual(p_dict["patient_id"]["provenance"], ProvenanceType.DERIVED_VALUE)
        self.assertEqual(p_dict["arrival_time"]["provenance"], ProvenanceType.SOURCE_VALUE)
        self.assertEqual(p_dict["survival_likelihood"]["provenance"], ProvenanceType.SIMULATED_VALUE)
        self.assertEqual(p_dict["waiting_time_minutes"]["provenance"], ProvenanceType.SIMULATED_VALUE)
        self.assertEqual(p_dict["patient_status"]["provenance"], ProvenanceType.SIMULATED_VALUE)

    # 6. Priority score calculation test
    def test_06_priority_score_calculation(self):
        patient = Patient(
            record_id="9999",
            sofa_score=10.0,            # severity = 50.0
            survival_likelihood=100.0,  # survival = 100.0
            waiting_time_minutes=120    # wait = 100.0
        )
        score = self.engine.calculate_priority_score(patient)
        self.assertAlmostEqual(score, 75.0)

    # 7. Priority engine weight configuration test
    def test_07_priority_engine_weight_configuration(self):
        engine = PriorityEngine(weight_severity=1.0, weight_survival=0.0, weight_waiting=0.0)
        patient = Patient(record_id="8888", sofa_score=10.0, survival_likelihood=10.0, waiting_time_minutes=10)
        score = engine.calculate_priority_score(patient)
        self.assertAlmostEqual(score, 50.0)

    # 8. Deterministic ranking ordering test
    def test_08_deterministic_ranking_ordering(self):
        p1 = Patient(record_id="101", sofa_score=4.0, survival_likelihood=50.0, waiting_time_minutes=30)
        p2 = Patient(record_id="102", sofa_score=12.0, survival_likelihood=80.0, waiting_time_minutes=60)
        p3 = Patient(record_id="103", sofa_score=8.0, survival_likelihood=70.0, waiting_time_minutes=45)

        ranked = self.engine.rank_patients([p1, p2, p3])
        self.assertEqual(ranked[0].rank, 1)
        self.assertEqual(ranked[0].patient_id, "P-102")
        self.assertGreater(ranked[0].priority_score, ranked[1].priority_score)
        self.assertGreater(ranked[1].priority_score, ranked[2].priority_score)

    # 9. Missing data graceful handling test
    def test_09_missing_data_graceful_handling(self):
        patient = Patient(record_id="555", sofa_score=None, survival_likelihood=None, waiting_time_minutes=None)
        self.assertEqual(patient.severity, 0.0)
        score = self.engine.calculate_priority_score(patient)
        self.assertGreaterEqual(score, 0.0)
        self.assertLessEqual(score, 100.0)

    # 10. API ICU overview test
    def test_10_api_icu_overview(self):
        patients = get_ranked_patients(limit=50)
        self.assertGreater(len(patients), 0)
        critical = [p for p in patients if p.severity >= 70.0]
        self.assertIsInstance(len(critical), int)

    # 11. API patients ranking list test
    def test_11_api_patients_ranking_list(self):
        patients = get_ranked_patients(limit=10)
        self.assertEqual(len(patients), 10)
        self.assertEqual(patients[0].rank, 1)
        self.assertEqual(patients[1].rank, 2)
        self.assertGreaterEqual(patients[0].priority_score, patients[1].priority_score)

    # 12. API patient detail test
    def test_12_api_patient_detail(self):
        patients = get_ranked_patients(limit=5)
        target = patients[0]
        p_dict = target.to_dict()

        self.assertIn("patient_id", p_dict)
        self.assertIn("severity", p_dict)
        self.assertIn("survival_likelihood", p_dict)
        self.assertIn("waiting_time_minutes", p_dict)
        self.assertIn("provenance", p_dict)

    # 13. End-to-end workflow test
    def test_13_end_to_end_workflow(self):
        raw_list = self.loader.load_patients(limit=25)
        ranked = self.engine.rank_patients(raw_list)

        self.assertEqual(len(ranked), 25)
        for p in ranked:
            self.assertIsNotNone(p.priority_score)
            self.assertGreater(p.rank, 0)
            self.assertIn("P-", p.patient_id)

    # 14. UI contract and schema verification
    def test_14_ui_contract_and_schema(self):
        patients = get_ranked_patients(limit=1)
        p = patients[0].to_dict()

        required_keys = [
            "rank", "patient_id", "severity", "survival_likelihood",
            "waiting_time_minutes", "priority_score", "patient_status",
            "arrival_time", "provenance"
        ]
        for key in required_keys:
            self.assertIn(key, p)

    # 15. Factor contributions breakdown test (V2)
    def test_15_factor_contributions_breakdown(self):
        patient = Patient(record_id="7777", sofa_score=10.0, survival_likelihood=80.0, waiting_time_minutes=60)
        score = self.engine.calculate_priority_score(patient)
        expected_sev = 50.0 * 0.50   # 25.0
        expected_surv = 80.0 * 0.30  # 24.0
        expected_wait = 50.0 * 0.20  # 10.0
        self.assertAlmostEqual(patient.severity_contribution, expected_sev)
        self.assertAlmostEqual(patient.survival_contribution, expected_surv)
        self.assertAlmostEqual(patient.waiting_contribution, expected_wait)
        self.assertAlmostEqual(score, expected_sev + expected_surv + expected_wait)

    # 16. Near-tie break hierarchy test (V2)
    def test_16_near_tie_break_hierarchy(self):
        # p1 score: 25.0 (sev) + 21.0 (surv) + 5.0 (wait) = 51.0
        p1 = Patient(record_id="201", sofa_score=10.0, survival_likelihood=70.0, waiting_time_minutes=30)
        # p2 score: 20.0 (sev) + 21.0 (surv) + 10.0 (wait) = 51.0
        p2 = Patient(record_id="202", sofa_score=8.0, survival_likelihood=70.0, waiting_time_minutes=60)
        
        ranked = self.engine.rank_patients([p1, p2])
        self.assertEqual(ranked[0].patient_id, "P-201")  # Higher severity contribution wins tie
        self.assertTrue(ranked[0].tie_broken)

    # 17. Dynamic event engine test (V2)
    def test_17_dynamic_event_engine(self):
        p1 = Patient(record_id="301", sofa_score=2.0, survival_likelihood=50.0, waiting_time_minutes=10)
        p2 = Patient(record_id="302", sofa_score=4.0, survival_likelihood=50.0, waiting_time_minutes=10)
        self.events.load_patients([p1, p2])

        # Spike p1 severity (SOFA 2 -> 18)
        result = self.events.process_event("SEVERITY_UPDATED", patient_id="P-301", new_value=18.0)
        self.assertEqual(result["status"], "success")
        self.assertEqual(p1.rank, 1)

    # 18. Audit logger tracking test (V2)
    def test_18_audit_logger_tracking(self):
        p1 = Patient(record_id="401", sofa_score=5.0)
        self.events.load_patients([p1])
        self.events.process_event("SEVERITY_UPDATED", patient_id="P-401", new_value=15.0)

        logs = self.audit.get_events()
        self.assertGreater(len(logs), 0)
        self.assertEqual(logs[0]["patient_id"], "P-401")

    # 19. Simulation engine scenario test (V2)
    def test_19_simulation_engine_scenario(self):
        self.sim.seed_initial_state()
        res = self.sim.simulate_new_critical_patient()
        self.assertEqual(res["status"], "success")
        
        reset_res = self.sim.reset_simulation()
        self.assertEqual(reset_res["status"], "success")

    # 20. Deterministic explainability test (V2)
    def test_20_deterministic_explainability(self):
        p1 = Patient(record_id="501", sofa_score=10.0, survival_likelihood=80.0, waiting_time_minutes=30)
        p2 = Patient(record_id="502", sofa_score=6.0, survival_likelihood=60.0, waiting_time_minutes=15)
        self.engine.rank_patients([p1, p2])

        exp = self.engine.explain_patient(p1, compare_to=p2)
        self.assertIn("explanation_text", exp)
        self.assertIn("comparison_explanation", exp)
        self.assertIn("P-501", exp["explanation_text"])

    # 21. Intelligence Engine V3.0 foundation test
    def test_21_intelligence_engine_foundation(self):
        self.sim.seed_initial_state()
        res_why = self.intel.ask("Why is the top-ranked patient #1?")
        self.assertEqual(res_why["status"], "success")
        self.assertIn("CareGrid Current Priority State", res_why["source"])
        self.assertIn("evidence", res_why)

        res_sum = self.intel.ask("Summarize the current queue.")
        self.assertEqual(res_sum["status"], "success")

        res_state = self.intel.ask("What is the current priority state?")
        self.assertEqual(res_state["status"], "success")


if __name__ == "__main__":
    unittest.main()
