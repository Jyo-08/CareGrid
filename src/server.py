"""
CareGrid V2 - REST API & Web Server
Pure Python HTTP server serving V1/V2 REST API endpoints, dynamic event arbitration,
simulation triggers, audit trail, deterministic explainability, and static UI assets.
"""

import os
import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from src.data_loader import DataLoader
from src.priority_engine import PriorityEngine
from src.audit_logger import AuditLogger
from src.event_engine import EventEngine
from src.simulation_engine import SimulationEngine, WhatIfSimulationEngine
from src.intelligence_engine import IntelligenceEngine
from src.attention_engine import AttentionEngine

PORT = 8080
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# Singletons initialization
loader = DataLoader(base_dir=BASE_DIR)
priority_engine = PriorityEngine(weight_severity=0.50, weight_survival=0.30, weight_waiting=0.20, near_tie_threshold=0.50)
audit_logger = AuditLogger()
event_engine = EventEngine(priority_engine=priority_engine, audit_logger=audit_logger)
attention_engine = AttentionEngine()
event_engine.attention_engine = attention_engine
sim_engine = SimulationEngine(data_loader=loader, event_engine=event_engine)
whatif_engine = WhatIfSimulationEngine(priority_engine=priority_engine)
intelligence_engine = IntelligenceEngine(event_engine=event_engine, priority_engine=priority_engine)

# Seed initial state
sim_engine.seed_initial_state()


def get_ranked_patients(limit: int = 100):
    return event_engine.get_ranked_patients(limit=limit)


class CareGridRequestHandler(BaseHTTPRequestHandler):

    def send_json_response(self, data: dict, status_code: int = 200):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode("utf-8"))

    def send_file_response(self, filepath: str, content_type: str):
        if not os.path.exists(filepath):
            self.send_error(404, "File Not Found")
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        with open(filepath, "rb") as f:
            self.wfile.write(f.read())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query_params = urllib.parse.parse_qs(parsed_url.query)

        if path == "/api/patients" or path == "/api/ranking":
            limit = int(query_params.get("limit", [50])[0])
            patients = event_engine.get_ranked_patients(limit=limit)
            response_data = {
                "status": "success",
                "count": len(patients),
                "patients": [p.to_dict() for p in patients]
            }
            self.send_json_response(response_data)

        elif path.startswith("/api/patients/") or path.startswith("/api/patient/"):
            patient_id = path.replace("/api/patients/", "").replace("/api/patient/", "").strip()
            all_patients = event_engine.get_ranked_patients()
            target = next((p for p in all_patients if p.patient_id == patient_id or p.record_id == patient_id), None)
            if target:
                self.send_json_response({"status": "success", "patient": target.to_dict()})
            else:
                self.send_json_response({"status": "error", "message": f"Patient {patient_id} not found"}, 404)

        elif path == "/api/icu/overview":
            all_patients = event_engine.get_ranked_patients()
            waiting = [p for p in all_patients if p.patient_status == "Waiting"]
            critical = [p for p in all_patients if p.severity >= 70.0]
            
            overview = {
                "status": "success",
                "total_patients": len(all_patients),
                "waiting_patients": len(waiting),
                "total_beds": event_engine.total_beds,
                "occupied_beds": event_engine.occupied_beds,
                "available_beds": event_engine.total_beds - event_engine.occupied_beds,
                "critical_patients": len(critical),
                "weights": priority_engine.get_weights(),
                "near_tie_threshold": priority_engine.near_tie_threshold
            }
            self.send_json_response(overview)

        elif path == "/api/priority-weights":
            self.send_json_response({"status": "success", "weights": priority_engine.get_weights()})

        elif path == "/api/audit":
            limit = int(query_params.get("limit", [50])[0])
            events = audit_logger.get_events(limit=limit)
            self.send_json_response({"status": "success", "count": len(events), "audit_trail": events})

        elif path.startswith("/api/explain/"):
            pid = path.replace("/api/explain/", "").strip()
            all_patients = event_engine.get_ranked_patients()
            target = next((p for p in all_patients if p.patient_id == pid or p.record_id == pid), None)
            if not target:
                target = event_engine.patients_map.get(pid)
            
            compare_pid = query_params.get("compare_with", [None])[0]
            compare_target = next((p for p in all_patients if p.patient_id == compare_pid or p.record_id == compare_pid), None) if compare_pid else None

            if target:
                explanation = priority_engine.explain_patient(target, compare_to=compare_target)
                self.send_json_response({"status": "success", "explainability": explanation})
            else:
                self.send_json_response({"status": "error", "message": f"Patient {pid} not found"}, 404)

        elif path == "/api/methodology":
            methodology_info = {
                "status": "success",
                "weights": priority_engine.get_weights(),
                "near_tie_threshold": priority_engine.near_tie_threshold,
                "severity_formula": "clamp(SOFA / 20.0 * 100.0, 0, 100)",
                "waiting_normalization": "clamp(waiting_time_minutes / 120.0 * 100.0, 0, 100)",
                "tie_breaking_hierarchy": [
                    "Tier 1: Higher severity_contribution",
                    "Tier 2: Longer waiting_time_minutes",
                    "Tier 3: Higher survival_likelihood",
                    "Tier 4: Lexicographical patient_id"
                ],
                "provenance_policy": {
                    "SOURCE_VALUE": "Direct value from X_train_2025.csv / patients.csv",
                    "DERIVED_VALUE": "Calculated value (severity from SOFA, P- recordid)",
                    "SIMULATED_VALUE": "Prototype simulation (survival, wait time, bed state)"
                }
            }
            self.send_json_response(methodology_info)

        elif path == "/api/validation":
            all_patients = event_engine.get_ranked_patients()
            sofa_vals = [p.sofa_score for p in all_patients]
            sev_vals = [p.severity for p in all_patients]
            score_vals = [p.priority_score for p in all_patients]

            sanity_report = {
                "status": "success",
                "total_records_loaded": len(all_patients),
                "sofa_range": {"min": min(sofa_vals) if sofa_vals else 0, "max": max(sofa_vals) if sofa_vals else 0},
                "severity_range": {"min": min(sev_vals) if sev_vals else 0, "max": max(sev_vals) if sev_vals else 0},
                "score_range": {"min": min(score_vals) if score_vals else 0, "max": max(score_vals) if score_vals else 0},
                "audit_events_recorded": len(audit_logger.events),
                "deterministic": True
            }
            self.send_json_response(sanity_report)

        elif path == "/api/intelligence/state":
            snapshot = intelligence_engine.get_current_snapshot()
            self.send_json_response({"status": "success", "snapshot": snapshot})

        elif path == "/api/attention/major-changes":
            threshold = int(parsed_url.query.split("threshold=")[1].split("&")[0]) if "threshold=" in parsed_url.query else 2
            changes = intelligence_engine.detect_major_rank_changes(threshold=threshold)
            self.send_json_response({"status": "success", "major_changes": changes, "count": len(changes)})

        elif path == "/api/attention/config":
            self.send_json_response({
                "status": "success",
                "config": attention_engine.config.to_dict()
            })

        elif path == "/api/attention/signals":
            signals = attention_engine.evaluate_attention_signals(event_engine, audit_logger)
            self.send_json_response({
                "status": "success",
                "signals": signals,
                "count": len(signals),
                "thresholds": attention_engine.config.to_dict()
            })

        elif path == "/api/analytics/organ-distribution":
            try:
                all_patients = event_engine.get_ranked_patients()
                distribution = {
                    "neurological_critical": 0,
                    "cardiovascular_critical": 0,
                    "respiratory_critical": 0,
                    "coagulation_critical": 0,
                    "liver_critical": 0,
                    "kidney_critical": 0,
                    "data_unavailable_counts": {
                        "neurological": 0,
                        "cardiovascular": 0,
                        "respiratory": 0,
                        "coagulation": 0,
                        "liver": 0,
                        "kidney": 0
                    }
                }
                for p in all_patients:
                    decomp = getattr(p, "get_clinical_decomposition", None)
                    if callable(decomp):
                        c_data = decomp()
                        c_factors = c_data.get("clinical_factors", {})
                        for organ, o_info in c_factors.items():
                            if not o_info.get("available"):
                                distribution["data_unavailable_counts"][organ] += 1
                            elif o_info.get("category") in ("CRITICAL", "SEVERE"):
                                key_name = f"{organ}_critical"
                                if key_name in distribution:
                                    distribution[key_name] += 1

                self.send_json_response({
                    "status": "success",
                    "organ_distribution": distribution,
                    "total_patients": len(all_patients)
                })
            except Exception as e:
                self.send_json_response({"status": "error", "message": str(e)}, 500)

        # Static UI Assets
        elif path == "/" or path == "/index.html":
            self.send_file_response(os.path.join(BASE_DIR, "static/index.html"), "text/html")
        elif path == "/style.css":
            self.send_file_response(os.path.join(BASE_DIR, "static/style.css"), "text/css")
        elif path == "/app.js":
            self.send_file_response(os.path.join(BASE_DIR, "static/app.js"), "application/javascript")
        else:
            self.send_error(404, "Page Not Found")

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
        try:
            data = json.loads(body) if body else {}
        except Exception:
            data = {}

        if path == "/api/intelligence/ask":
            q = data.get("question", "")
            try:
                res = intelligence_engine.ask(question=q)
                self.send_json_response(res)
            except Exception as e:
                self.send_json_response({
                    "status": "error",
                    "message": f"CareGrid Intelligence Unavailable: {str(e)}"
                }, 500)

        elif path == "/api/intelligence/ask-patient":
            patient_id = data.get("patient_id", "")
            mode = data.get("mode", "why_ranked")
            free_question = data.get("question", "")
            if not patient_id:
                self.send_json_response({"status": "error", "message": "patient_id is required"}, 400)
                return
            try:
                res = intelligence_engine.ask_about_patient(
                    patient_id=patient_id,
                    mode=mode,
                    free_question=free_question
                )
                self.send_json_response(res)
            except Exception as e:
                self.send_json_response({
                    "status": "error",
                    "message": f"CareGrid Patient Intelligence Unavailable: {str(e)}"
                }, 500)

        elif path == "/api/intelligence/explain-major-change":
            patient_id = data.get("patient_id")
            try:
                res = intelligence_engine.explain_major_rank_change(patient_id=patient_id)
                self.send_json_response(res)
            except Exception as e:
                self.send_json_response({"status": "error", "message": str(e)}, 500)

        elif path == "/api/intelligence/explain-attention":
            signal = data.get("signal", {})
            try:
                res = intelligence_engine.explain_attention_signal(signal)
                self.send_json_response(res)
            except Exception as e:
                self.send_json_response({"status": "error", "message": str(e)}, 500)


        elif path == "/api/priority-weights":
            try:
                w_sev = float(data.get("weight_severity", 0.50))
                w_surv = float(data.get("weight_survival", 0.30))
                w_wait = float(data.get("weight_waiting", 0.20))
                priority_engine.set_weights(w_sev, w_surv, w_wait)
                
                event_engine.re_rank_all(trigger_reason="WEIGHTS_UPDATED")
                audit_logger.log_event(
                    event_type="METHODOLOGY_WEIGHTS_UPDATED",
                    reason=f"Priority Engine weights updated: Sev={w_sev}, Surv={w_surv}, Wait={w_wait}",
                    source="USER_INTERFACE"
                )

                self.send_json_response({"status": "success", "weights": priority_engine.get_weights()})
            except Exception as e:
                self.send_json_response({"status": "error", "message": str(e)}, 400)

        elif path == "/api/attention/config":
            try:
                prev_config = attention_engine.config.to_dict()
                if data.get("reset") is True:
                    new_config = attention_engine.config.reset_to_defaults()
                    audit_logger.log_event(
                        event_type="ATTENTION_CONFIG_RESET",
                        previous_value=prev_config,
                        new_value=new_config,
                        reason="Attention Engine operational thresholds reset to default baseline policy",
                        source="USER_INTERFACE"
                    )
                    self.send_json_response({
                        "status": "success",
                        "message": "Attention Configuration reset to default baseline",
                        "config": new_config
                    })
                else:
                    new_config = attention_engine.config.update(
                        near_tie_threshold=data.get("near_tie_threshold"),
                        critical_severity_threshold=data.get("critical_severity_threshold"),
                        critical_queue_load_threshold=data.get("critical_queue_load_threshold"),
                        waiting_time_threshold=data.get("waiting_time_threshold"),
                        major_rank_change_threshold=data.get("major_rank_change_threshold")
                    )
                    audit_logger.log_event(
                        event_type="ATTENTION_CONFIG_UPDATED",
                        previous_value=prev_config,
                        new_value=new_config,
                        reason=f"Attention Engine threshold configuration updated: NearTie={new_config['near_tie_threshold']}, CritSev={new_config['critical_severity_threshold']}, CritLoad={new_config['critical_queue_load_threshold']}, WaitTime={new_config['waiting_time_threshold']}, RankChange={new_config['major_rank_change_threshold']}",
                        source="USER_INTERFACE"
                    )
                    self.send_json_response({
                        "status": "success",
                        "message": "Attention Configuration updated successfully",
                        "config": new_config
                    })
            except ValueError as ve:
                self.send_json_response({"status": "error", "message": str(ve)}, 400)
            except Exception as e:
                self.send_json_response({"status": "error", "message": str(e)}, 500)

        elif path == "/api/events":
            evt_type = data.get("event_type")
            pid = data.get("patient_id")
            new_val = data.get("new_value")
            reason = data.get("reason", "")
            try:
                result = event_engine.process_event(event_type=evt_type, patient_id=pid, new_value=new_val, reason=reason)
                self.send_json_response(result)
            except Exception as e:
                self.send_json_response({"status": "error", "message": str(e)}, 400)

        elif path == "/api/simulation/event" or path == "/api/simulation/events":
            action = data.get("action")
            try:
                if action == "new_critical_patient":
                    res = sim_engine.simulate_new_critical_patient()
                elif action == "severity_spike":
                    pid = data.get("patient_id", "P-137517")
                    res = sim_engine.simulate_patient_severity_spike(patient_id=pid)
                elif action == "advance_time":
                    mins = int(data.get("minutes", 30))
                    res = sim_engine.simulate_advance_time(minutes=mins)
                elif action == "discharge_top":
                    res = sim_engine.simulate_discharge_top_patient()
                elif action == "reset":
                    res = sim_engine.reset_simulation()
                else:
                    res = {"status": "error", "message": f"Unknown simulation action: {action}"}
                self.send_json_response(res)
            except Exception as e:
                self.send_json_response({"status": "error", "message": str(e)}, 400)

        elif path == "/api/simulation/what-if":
            pid = data.get("patient_id")
            scenario_changes = data.get("scenario_changes", {})
            cap_change = int(data.get("capacity_change", 0))

            if not pid:
                self.send_json_response({"status": "error", "message": "patient_id is required for what-if simulation"}, 400)
                return

            if not scenario_changes:
                self.send_json_response({"status": "error", "message": "scenario_changes must contain at least one factor update"}, 400)
                return

            try:
                live_patients = event_engine.get_ranked_patients()
                sim_res = whatif_engine.run_what_if_scenario(
                    live_patients=live_patients,
                    patient_id=pid,
                    scenario_changes=scenario_changes,
                    capacity_change=cap_change
                )
                self.send_json_response(sim_res)
            except Exception as e:
                self.send_json_response({"status": "error", "message": f"What-If Simulation error: {str(e)}"}, 500)

        elif path == "/api/simulation/reset":
            res = sim_engine.reset_simulation()
            self.send_json_response(res)

        else:
            self.send_error(404, "Endpoint Not Found")


def run_server(port=PORT):
    server_address = ("", port)
    httpd = HTTPServer(server_address, CareGridRequestHandler)
    print(f"CareGrid V2 Server running on http://localhost:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    run_server()
