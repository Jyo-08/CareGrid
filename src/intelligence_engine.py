"""
CareGrid V3.0 / V3.1 — Intelligence Foundation Engine
Grounded AI interaction layer built strictly on top of the CareGrid V2 deterministic state.

Rules:
1. Deterministic CareGrid engine remains the sole source of truth.
2. AI DOES NOT make ICU allocation decisions or calculate priority scores.
3. AI ONLY interprets and explains information supplied by CareGrid context.
"""

import os
import json
import re
from typing import Dict, Any, List, Optional

def load_env_file(base_dir: Optional[str] = None):
    """Loads key-value pairs from .env file into os.environ if present."""
    if base_dir is None:
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    env_path = os.path.join(base_dir, ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k and k not in os.environ:
                            os.environ[k] = v
        except Exception:
            pass

load_env_file()

SYSTEM_PROMPT = """You are CareGrid Intelligence.
You explain the current state of the CareGrid decision-support system.
You MUST use only the structured CareGrid context provided to you.
You MUST NOT invent patient information, clinical values, scores, rankings, events or outcomes.
You MUST NOT make clinical diagnoses or treatment recommendations.
You MUST NOT decide ICU allocation.
You MUST NOT override the deterministic CareGrid engine.
If the requested information is not present in the supplied context, state that the information is unavailable.
"""

PATIENT_SYSTEM_PROMPT = """You are CareGrid Intelligence operating on a selected CareGrid patient.
Use ONLY the structured patient and system context supplied by CareGrid.
Never invent patient information, scores, rankings, clinical values, events or outcomes.
Never modify CareGrid state.
Never calculate or override the official CareGrid priority.
Never provide diagnosis or treatment recommendations.
Explain the deterministic result produced by CareGrid.
If information is unavailable, clearly state that it is unavailable."""

class IntelligenceEngine:
    def __init__(self, event_engine, priority_engine):
        self.event_engine = event_engine
        self.priority_engine = priority_engine

    def call_gemini_api(self, prompt: str, system_instruction: str, context_data: Dict[str, Any]) -> Optional[str]:
        """
        Executes grounded Gemini API generation using GEMINI_API_KEY from environment.
        Returns generated answer string if successful, or None if key is missing/call fails.
        """
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return None

        primary_model = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
        models = [primary_model, "gemini-flash-latest", "gemini-3.5-flash", "gemini-3.6-flash", "gemini-2.5-flash"]
        seen = set()
        model_list = [m for m in models if not (m in seen or seen.add(m))]

        formatted_payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": (
                                f"{system_instruction}\n\n"
                                f"GROUNDED CAREGRID SYSTEM & PATIENT CONTEXT:\n"
                                f"```json\n{json.dumps(context_data, indent=2, default=str)}\n```\n\n"
                                f"USER QUESTION:\n{prompt}"
                            )
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 1024
            }
        }

        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": api_key
        }

        import requests
        for model_name in model_list:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
            try:
                resp = requests.post(url, json=formatted_payload, headers=headers, timeout=5)
                if resp.status_code == 200:
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts:
                            text = parts[0].get("text", "").strip()
                            if text:
                                return text
                elif resp.status_code in (404, 400):
                    continue
                else:
                    print(f"[CareGrid Gemini API] Returned HTTP {resp.status_code}: {resp.text[:200]}")
                    return None
            except Exception as exc:
                print(f"[CareGrid Gemini API] Exception: {str(exc)}")
                return None

        return None

    def resolve_target_patient_from_query(self, question: str, patient_id: Optional[str] = None):
        """
        Dynamically resolves (target_patient, resolved_rank, comparison_patient) from user question.
        Never defaults to rank #1 unless rank #1 is explicitly requested.
        """
        all_patients = self.event_engine.get_ranked_patients()
        if not all_patients:
            return None, None, None

        q_norm = question.strip().lower()

        # 1. Direct Patient ID match (e.g. P-152433)
        match_pid = re.search(r'P-?\d{4,}', question, re.IGNORECASE)
        if match_pid:
            raw_m = match_pid.group(0).upper()
            pid = raw_m if raw_m.startswith("P-") else f"P-{raw_m[1:]}"
            target = next((p for p in all_patients if p.patient_id == pid or p.record_id == pid), None)
            if not target:
                target = self.event_engine.patients_map.get(pid)
            if target:
                comp = all_patients[0] if (target.rank and target.rank > 1 and all_patients) else None
                return target, target.rank, comp

        if patient_id:
            target = next((p for p in all_patients if p.patient_id == patient_id or p.record_id == patient_id), None)
            if not target:
                target = self.event_engine.patients_map.get(patient_id)
            if target:
                comp = all_patients[0] if (target.rank and target.rank > 1 and all_patients) else None
                return target, target.rank, comp

        # 2. Ordinal words mapping
        ordinals = {
            "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
            "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10
        }

        target_rank = None

        # Check ordinals
        for word, r in ordinals.items():
            if word in q_norm:
                target_rank = r
                break

        # Check explicit regex patterns if no ordinal matched
        if target_rank is None:
            m_rank = re.search(r'(?:#|rank\s*#?|ranked\s*#?|position\s*#?|patient\s*#?)\s*(\d+)', q_norm)
            if m_rank:
                try:
                    val = int(m_rank.group(1))
                    if 1 <= val <= 50:
                        target_rank = val
                except ValueError:
                    pass

        if target_rank is None:
            m_hash = re.search(r'#(\d+)', q_norm)
            if m_hash:
                try:
                    target_rank = int(m_hash.group(1))
                except ValueError:
                    pass

        if target_rank is not None:
            idx = target_rank - 1
            if 0 <= idx < len(all_patients):
                target_p = all_patients[idx]
                comp_p = all_patients[0] if (target_rank > 1) else (all_patients[1] if len(all_patients) > 1 else None)
                return target_p, target_rank, comp_p

        return None, None, None

    def build_current_context(self) -> Dict[str, Any]:
        """Extract a structured snapshot of the current CareGrid state."""
        return self.get_current_snapshot()

    def get_current_snapshot(self) -> Dict[str, Any]:
        all_patients = self.event_engine.get_ranked_patients()
        top_patient = all_patients[0] if all_patients else None
        waiting_count = len([p for p in all_patients if p.patient_status == "Waiting"])
        critical_count = len([p for p in all_patients if p.severity >= 70.0])
        weights = self.priority_engine.get_weights()

        snapshot = {
            "total_patients_in_queue": len(all_patients),
            "waiting_patients_count": waiting_count,
            "critical_patients_count": critical_count,
            "occupied_beds": self.event_engine.occupied_beds,
            "total_beds": self.event_engine.total_beds,
            "available_beds": self.event_engine.total_beds - self.event_engine.occupied_beds,
            "weights": weights,
            "top_patient": top_patient.to_dict() if top_patient else None
        }
        return snapshot

    def _build_deterministic_patient_explanation(
        self,
        target_p: Any,
        resolved_rank: Optional[int],
        comp_p: Optional[Any],
        question: str,
        evidence: Dict[str, Any],
        context_summary: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generates a grounded deterministic fallback explanation for a specific resolved patient."""
        weights = self.priority_engine.get_weights()
        sev_contrib = round(target_p.severity * weights["weight_severity"], 1)
        surv_contrib = round(target_p.survival_likelihood * weights["weight_survival"], 1)
        wait_contrib = round(min(100.0, target_p.waiting_time_minutes / 1.2) * weights["weight_waiting"], 1)

        contribs = [
            ("Severity (SOFA)", sev_contrib),
            ("Prognostic Survival", surv_contrib),
            ("Waiting Duration", wait_contrib)
        ]
        dominant_name, dominant_val = max(contribs, key=lambda x: x[1])

        lines = []
        if resolved_rank == 1 or target_p.rank == 1:
            lines.append(f"EXPLANATION FOR RANK #1 PATIENT ({target_p.patient_id})\n")
            lines.append(f"Patient {target_p.patient_id} holds Rank #1 with an official CareGrid priority score of {target_p.priority_score:.1f} / 100.0.\n")
            lines.append("KEY CONTRIBUTING FACTORS:")
            lines.append(f"• Severity (SOFA {target_p.sofa_score}): +{sev_contrib:.1f} pts (50% weight)")
            lines.append(f"• Survival Likelihood ({target_p.survival_likelihood:.1f}%): +{surv_contrib:.1f} pts (30% weight)")
            lines.append(f"• Waiting Duration ({target_p.waiting_time_minutes} min): +{wait_contrib:.1f} pts (20% weight)\n")
            lines.append(f"Dominant Driver: {dominant_name} (+{dominant_val:.1f} pts).")
        else:
            lines.append(f"EXPLANATION FOR RANK #{target_p.rank} PATIENT ({target_p.patient_id})\n")
            lines.append(f"Patient {target_p.patient_id} is currently ranked #{target_p.rank} with a priority score of {target_p.priority_score:.1f}.\n")
            lines.append(f"The patient is ranked #{target_p.rank} because their calculated priority score ({target_p.priority_score:.1f}) is lower than Rank #1 but higher than remaining queue candidates.\n")
            lines.append("SCORE BREAKDOWN:")
            lines.append(f"• Severity (SOFA {target_p.sofa_score}): +{sev_contrib:.1f} pts")
            lines.append(f"• Survival Likelihood ({target_p.survival_likelihood:.1f}%): +{surv_contrib:.1f} pts")
            lines.append(f"• Waiting Duration ({target_p.waiting_time_minutes} min): +{wait_contrib:.1f} pts")
            lines.append(f"• Total Score: {target_p.priority_score:.1f} pts\n")
            lines.append(f"Primary Driver: {dominant_name} (+{dominant_val:.1f} pts).\n")

        if comp_p:
            score_gap = round(comp_p.priority_score - target_p.priority_score, 1)
            lines.append(f"WHY NOT RANK #1:")
            lines.append(f"• Rank #1 Patient: {comp_p.patient_id}")
            lines.append(f"• Rank #1 Priority Score: {comp_p.priority_score:.1f} pts")
            lines.append(f"• Score Gap: {score_gap:.1f} pts above Patient {target_p.patient_id}.")

        decomp = getattr(target_p, "get_clinical_decomposition", None)
        c_decomp = decomp() if callable(decomp) else {}
        c_factors = c_decomp.get("clinical_factors", {})
        overall_info = c_decomp.get("overall_severity", {})

        if c_factors:
            lines.append("\nV6 CLINICAL ORGAN-SYSTEM DECOMPOSITION:")
            for organ_key, o_data in c_factors.items():
                organ_name = o_data.get("name", organ_key.capitalize())
                if not o_data.get("available"):
                    lines.append(f"• {organ_name}: DATA UNAVAILABLE")
                else:
                    lines.append(f"• {organ_name}: {o_data.get('severity'):.1f}/100 ({o_data.get('category')}) — Evidence: {o_data.get('evidence')}")
            
            doms = overall_info.get("dominant_contributors", [])
            if doms:
                lines.append(f"Dominant Organ Drivers: {', '.join(doms)}")

        answer_text = "\n".join(lines)

        return {
            "status": "success",
            "question": question,
            "resolved_rank": resolved_rank or target_p.rank,
            "resolved_patient_id": target_p.patient_id,
            "answer": answer_text,
            "evidence": evidence,
            "source": "CareGrid Priority Engine (Deterministic Fallback)",
            "context_summary": context_summary
        }

    def ask(self, question: str, patient_id: Optional[str] = None) -> Dict[str, Any]:
        """Process a user question grounded strictly in current CareGrid state with distinct intent routing."""
        q_norm = question.strip().lower()
        snapshot = self.get_current_snapshot()
        all_patients = self.event_engine.get_ranked_patients()

        # Step 1: Execute Rank & Entity Reference Resolution
        target_p, resolved_rank, comp_p = self.resolve_target_patient_from_query(question, patient_id=patient_id)

        # Step 2: Build Evidence for the RESOLVED patient (or default top patient if system-level question)
        active_patient = target_p if target_p else (all_patients[0] if all_patients else None)
        weights = snapshot["weights"]
        evidence = {}
        if active_patient:
            evidence = {
                "patient_id": active_patient.patient_id,
                "rank": active_patient.rank,
                "priority_score": round(active_patient.priority_score, 1),
                "severity": active_patient.severity,
                "sofa_score": active_patient.sofa_score,
                "survival_likelihood": active_patient.survival_likelihood,
                "waiting_time_minutes": active_patient.waiting_time_minutes,
                "severity_contribution": round(active_patient.severity * weights["weight_severity"], 1),
                "survival_contribution": round(active_patient.survival_likelihood * weights["weight_survival"], 1),
                "waiting_contribution": round(min(100.0, active_patient.waiting_time_minutes / 1.2) * weights["weight_waiting"], 1)
            }

        top_p = all_patients[0] if all_patients else None
        context_summary = {
            "queue_size": snapshot["total_patients_in_queue"],
            "critical_count": snapshot["critical_patients_count"],
            "resolved_rank": resolved_rank or (active_patient.rank if active_patient else 1),
            "resolved_patient_id": active_patient.patient_id if active_patient else "N/A",
            "top_patient_id": top_p.patient_id if top_p else "N/A",
            "top_priority_score": round(top_p.priority_score, 1) if top_p else 0.0,
            "available_beds": snapshot["available_beds"]
        }

        # Step 3: Audit or Attention Signal Query Routing
        if any(w in q_norm for w in ["what changed", "recent changes", "audit", "history", "moved", "re-ranking", "trace"]):
            pid_to_audit = target_p.patient_id if target_p else patient_id
            return self.ask_audit(question, patient_id=pid_to_audit)

        if any(w in q_norm for w in ["flagged", "major rank", "attention"]):
            pid_to_att = target_p.patient_id if target_p else patient_id
            return self.explain_major_rank_change(patient_id=pid_to_att)

        # Step 4: Build Grounded Gemini Context
        if target_p:
            p_idx = (resolved_rank - 1) if (resolved_rank and 1 <= resolved_rank <= len(all_patients)) else (target_p.rank - 1 if target_p.rank else 0)
            rank_above = all_patients[p_idx - 1] if p_idx > 0 else None
            rank_below = all_patients[p_idx + 1] if p_idx < len(all_patients) - 1 else None

            p_data = {
                "patient_id": target_p.patient_id,
                "current_rank": target_p.rank or resolved_rank,
                "priority_score": round(target_p.priority_score, 1),
                "sofa_score": target_p.sofa_score,
                "derived_severity": round(target_p.severity, 1),
                "survival_likelihood": round(target_p.survival_likelihood, 1),
                "waiting_time_minutes": target_p.waiting_time_minutes,
                "severity_contribution": round(target_p.severity * weights["weight_severity"], 1),
                "survival_contribution": round(target_p.survival_likelihood * weights["weight_survival"], 1),
                "waiting_contribution": round(min(100.0, target_p.waiting_time_minutes / 1.2) * weights["weight_waiting"], 1),
                "patient_status": target_p.patient_status,
                "previous_rank": getattr(target_p, "previous_rank", None),
                "rank_delta": getattr(target_p, "rank_delta", 0),
                "tie_broken": getattr(target_p, "tie_broken", False),
                "tie_break_rule": getattr(target_p, "tie_break_rule", None)
            }

            gemini_context = {
                "TARGET_PATIENT": p_data,
                "TARGET_RANK": resolved_rank or target_p.rank,
                "RANK_NEIGHBORS": {
                    "rank_above": {
                        "patient_id": rank_above.patient_id,
                        "rank": rank_above.rank,
                        "priority_score": round(rank_above.priority_score, 1),
                        "sofa_score": rank_above.sofa_score,
                        "severity_contribution": round(rank_above.severity * weights["weight_severity"], 1),
                        "survival_likelihood": round(rank_above.survival_likelihood, 1),
                        "waiting_time_minutes": rank_above.waiting_time_minutes
                    } if rank_above else None,
                    "target_patient": p_data,
                    "rank_below": {
                        "patient_id": rank_below.patient_id,
                        "rank": rank_below.rank,
                        "priority_score": round(rank_below.priority_score, 1),
                        "sofa_score": rank_below.sofa_score,
                        "severity_contribution": round(rank_below.severity * weights["weight_severity"], 1),
                        "survival_likelihood": round(rank_below.survival_likelihood, 1),
                        "waiting_time_minutes": rank_below.waiting_time_minutes
                    } if rank_below else None,
                },
                "QUEUE_SUMMARY": {
                    "total_patients_in_queue": len(all_patients),
                    "waiting_patients_count": snapshot["waiting_patients_count"],
                    "critical_patients_count": snapshot["critical_patients_count"],
                    "occupied_beds": snapshot["occupied_beds"],
                    "available_beds": snapshot["available_beds"]
                },
                "RANKING_METHODOLOGY": {
                    "scoring_formula": "Score = (Severity × 0.50) + (Survival Likelihood × 0.30) + (Wait Duration × 0.20)",
                    "weights": weights
                }
            }

            sys_prompt = (
                f"You are CareGrid Intelligence.\n"
                f"The user is asking about the patient currently occupying Rank #{resolved_rank or target_p.rank} (Patient {target_p.patient_id}).\n"
                f"Use the supplied TARGET_PATIENT (Patient {target_p.patient_id}) as the primary subject of your answer.\n"
                f"Explain why Patient {target_p.patient_id} currently occupies Rank #{resolved_rank or target_p.rank}.\n"
                f"If the user asks why this patient is not Rank #1, compare their score breakdown against Rank #1 ({rank_above.patient_id if rank_above else 'N/A'}).\n"
                f"Use ONLY the supplied CareGrid context. Do NOT invent missing patient values. Do NOT calculate or override official CareGrid priority scores or ranks."
            )
        else:
            gemini_context = {"snapshot": snapshot, "top_patient": all_patients[0].to_dict() if all_patients else None}
            sys_prompt = SYSTEM_PROMPT

        # Step 5: Execute Gemini API call
        gemini_reply = self.call_gemini_api(question, sys_prompt, gemini_context)
        if gemini_reply:
            return {
                "status": "success",
                "question": question,
                "resolved_rank": resolved_rank or (active_patient.rank if active_patient else 1),
                "resolved_patient_id": active_patient.patient_id if active_patient else None,
                "answer": gemini_reply,
                "evidence": evidence,
                "source": "Gemini API | CareGrid Intelligence",
                "context_summary": context_summary
            }

        # Step 6: Deterministic Fallback Routing
        if target_p:
            return self._build_deterministic_patient_explanation(target_p, resolved_rank, comp_p, question, evidence, context_summary)

        # System-Level Summary Query Fallback
        if "summarize" in q_norm or "summary" in q_norm or "queue" in q_norm:
            top_p = all_patients[0] if all_patients else None
            answer = (
                f"CAREGRID ICU QUEUE SUMMARY\n\n"
                f"• Active Candidate Population: {snapshot['total_patients_in_queue']} total patients currently under arbitration.\n"
                f"• Critical Severity Cohort: {snapshot['critical_patients_count']} patients with SOFA-derived severity ≥ 70.0.\n"
                f"• Top Priority Candidate: Patient {top_p.patient_id if top_p else 'N/A'} (Rank #1, Priority Score: {top_p.priority_score:.1f if top_p else 0.0}).\n"
                f"• ICU Capacity State: {snapshot['occupied_beds']}/{snapshot['total_beds']} beds occupied ({snapshot['available_beds']} beds available for allocation).\n"
                f"• Engine Configuration: 50% Severity / 30% Survival Likelihood / 20% Waiting Equity."
            )
            return {
                "status": "success",
                "question": question,
                "answer": answer,
                "evidence": evidence,
                "source": "CareGrid Priority Engine (Deterministic Fallback)",
                "context_summary": context_summary
            }

        # General System State Fallback
        top_p = all_patients[0] if all_patients else None
        answer = (
            f"CareGrid Intelligence Context for query '{question}':\n\n"
            f"• Current Queue Population: {snapshot['total_patients_in_queue']} records under active arbitration.\n"
            f"• Highest Priority Candidate: Patient {top_p.patient_id if top_p else 'N/A'} (Rank #1, Priority Score: {top_p.priority_score:.1f if top_p else 0.0}).\n"
            f"• Configured Weights: 50% Severity / 30% Survival Likelihood / 20% Waiting Equity.\n"
            f"• Available Beds: {snapshot['available_beds']} beds."
        )
        return {
            "status": "success",
            "question": question,
            "answer": answer,
            "evidence": evidence,
            "source": "CareGrid Priority Engine (Deterministic Fallback)",
            "context_summary": context_summary
        }

        # ----------------------------------------------------------------------
        # DETERMINISTIC FALLBACK ROUTING
        # ----------------------------------------------------------------------
        # V3.5 AUDIT INTELLIGENCE QUESTIONS
        # ----------------------------------------------------------------------
        if any(w in q_norm for w in ["what changed", "recent changes", "audit", "history", "moved", "re-ranking", "trace"]):
            return self.ask_audit(question, patient_id=target_pid)

        # ----------------------------------------------------------------------
        # V3.5 SMALL ATTENTION FOUNDATION: MAJOR RANK CHANGE / WHY FLAGGED
        # ----------------------------------------------------------------------
        if any(w in q_norm for w in ["flagged", "major rank", "attention"]):
            return self.explain_major_rank_change(patient_id=target_pid)

        # ----------------------------------------------------------------------
        # CATEGORY 1: TOP PATIENT EXPLANATION (#1)
        # ----------------------------------------------------------------------
        if ("#1" in q_norm or "top" in q_norm or "highest" in q_norm or "first" in q_norm) and ("why" in q_norm or "explain" in q_norm or "reason" in q_norm or "ranked" in q_norm or "get" in q_norm or "one" in q_norm):
            if not top_p:
                answer = "No patients are currently in the CareGrid queue."
            else:
                answer = (
                    f"EXPLANATION FOR TOP-RANKED PATIENT #{top_p['rank']} ({top_p['patient_id']})\n\n"
                    f"Patient {top_p['patient_id']} holds Rank #1 with an official CareGrid priority score of {top_p['priority_score']:.1f} / 100.0.\n\n"
                    f"KEY CONTRIBUTING FACTORS:\n"
                    f"• Severity (SOFA-derived score {top_p['severity']:.1f}): +{evidence['severity_contribution']:.1f} pts (50% weight)\n"
                    f"• Survival Likelihood ({top_p['survival_likelihood']:.1f}%): +{evidence['survival_contribution']:.1f} pts (30% weight)\n"
                    f"• Waiting Duration Equity ({top_p['waiting_time_minutes']} min): +{evidence['waiting_contribution']:.1f} pts (20% weight)\n\n"
                    f"SOFA organ failure severity is currently the primary driver securing position #1 for Patient {top_p['patient_id']}."
                )

            return {
                "status": "success",
                "question": question,
                "answer": answer,
                "evidence": evidence,
                "source": "CareGrid Priority Engine (Deterministic Fallback)",
                "context_summary": context_summary
            }

        # ----------------------------------------------------------------------
        # CATEGORY 2: QUEUE SUMMARY
        # ----------------------------------------------------------------------
        elif "summarize" in q_norm or "summary" in q_norm or "everyone" in q_norm or "happening" in q_norm or ("queue" in q_norm and not "this" in q_norm):
            answer = (
                f"CAREGRID ICU QUEUE SUMMARY\n\n"
                f"• Active Candidate Population: {snapshot['total_patients_in_queue']} total patients currently under arbitration.\n"
                f"• Critical Severity Cohort: {snapshot['critical_patients_count']} patients with SOFA-derived severity ≥ 70.0.\n"
                f"• Top Priority Candidate: Patient {top_p['patient_id']} (Rank #1, Priority Score: {top_p['priority_score']:.1f}).\n"
                f"• ICU Capacity State: {snapshot['occupied_beds']}/{snapshot['total_beds']} beds occupied ({snapshot['available_beds']} beds available for allocation).\n"
                f"• Engine Configuration: 50% Severity / 30% Survival Likelihood / 20% Waiting Equity."
            )

            return {
                "status": "success",
                "question": question,
                "answer": answer,
                "evidence": evidence,
                "source": "CareGrid Current Priority State",
                "context_summary": context_summary
            }

        # ----------------------------------------------------------------------
        # CATEGORY 3: PRIORITY STATE & WEIGHTS
        # ----------------------------------------------------------------------
        elif "priority state" in q_norm or "weights" in q_norm or "scoring formula" in q_norm or ("state" in q_norm and not "patient" in q_norm):
            answer = (
                f"CAREGRID PRIORITY ENGINE STATE\n\n"
                f"• Status: ONLINE & DETERMINISTICALLY ACTIVE\n"
                f"• Scoring Formula: Score = (Severity × 0.50) + (Survival × 0.30) + (Wait × 0.20)\n"
                f"• Top Candidate Score: {top_p['priority_score']:.1f} (Patient {top_p['patient_id']})\n"
                f"• Evaluated Population: {snapshot['total_patients_in_queue']} active records ({snapshot['critical_patients_count']} critical)\n"
                f"• Provenance: All priority scores and rank positions are generated deterministically by CareGrid Priority Engine."
            )

            return {
                "status": "success",
                "question": question,
                "answer": answer,
                "evidence": evidence,
                "source": "CareGrid Priority Engine",
                "context_summary": context_summary
            }

        # ----------------------------------------------------------------------
        # CATEGORY 4: PATIENT COMPARISON / DIFFERENCE BETWEEN TOP TWO
        # ----------------------------------------------------------------------
        elif "difference" in q_norm or "compare" in q_norm or "top two" in q_norm or "versus" in q_norm or "vs" in q_norm:
            if len(all_patients) >= 2:
                res = self.compare_patients(all_patients[0].patient_id, all_patients[1].patient_id)
                return {
                    "status": "success",
                    "question": question,
                    "answer": res.get("explanation", ""),
                    "evidence": evidence,
                    "source": "CareGrid Priority Engine | CareGrid Current State",
                    "context_summary": context_summary
                }

        # ----------------------------------------------------------------------
        # CATEGORY 5: PATIENT-SPECIFIC QUERY / "THIS PATIENT" / "CONTRIBUTES MOST"
        # ----------------------------------------------------------------------
        if target_pid or "this patient" in q_norm or "patient" in q_norm or "contribute" in q_norm or "driver" in q_norm or "why" in q_norm:
            pid = target_pid or (top_p["patient_id"] if top_p else None)
            if pid:
                mode = "drivers" if ("contribute" in q_norm or "driver" in q_norm or "most" in q_norm) else "why_ranked"
                res = self.ask_about_patient(patient_id=pid, mode=mode, free_question=question)
                return {
                    "status": "success",
                    "question": question,
                    "answer": res.get("answer", ""),
                    "evidence": evidence,
                    "source": res.get("source", "CareGrid Current Patient State"),
                    "context_summary": context_summary
                }

        answer = (
            f"CareGrid Intelligence Context for query '{question}':\n\n"
            f"• Current Queue Population: {snapshot['total_patients_in_queue']} records under active arbitration.\n"
            f"• Highest Priority Candidate: Patient {top_p['patient_id']} (Rank #1, Priority Score: {top_p['priority_score']:.1f}).\n"
            f"• Configured Weights: 50% Severity / 30% Survival Likelihood / 20% Waiting Equity.\n"
            f"• Available Beds: {snapshot['available_beds']} beds.\n\n"
            f"You can ask about queue summary, priority state, top patient explanation, or recent audit changes."
        )

        return {
            "status": "success",
            "question": question,
            "answer": answer,
            "evidence": evidence,
            "source": "CareGrid Current Priority State",
            "context_summary": context_summary
        }

    def build_patient_context(self, patient_id: str) -> Optional[Dict[str, Any]]:
        """Build structured context for a specific patient from live CareGrid state."""
        all_patients = self.event_engine.get_ranked_patients()
        target_idx = next((i for i, p in enumerate(all_patients) if p.patient_id == patient_id or p.record_id == patient_id), None)
        if target_idx is None:
            return None

        target = all_patients[target_idx]
        weights = self.priority_engine.get_weights()

        # Deterministic contribution calculation (mirrors priority_engine logic)
        sev_contrib = round(target.severity * weights["weight_severity"], 1)
        surv_contrib = round(target.survival_likelihood * weights["weight_survival"], 1)
        wait_raw = min(100.0, target.waiting_time_minutes / 1.2)
        wait_contrib = round(wait_raw * weights["weight_waiting"], 1)

        # Identify neighboring queue positions
        patient_above = all_patients[target_idx - 1] if target_idx > 0 else None
        patient_below = all_patients[target_idx + 1] if target_idx < len(all_patients) - 1 else None

        context = {
            "patient": {
                "patient_id": target.patient_id,
                "rank": target.rank,
                "priority_score": round(target.priority_score, 1),
                "severity": round(target.severity, 1),
                "survival_likelihood": round(target.survival_likelihood, 1),
                "waiting_time_minutes": target.waiting_time_minutes,
                "patient_status": target.patient_status,
                "sofa_score": target.sofa_score,
            },
            "contributions": {
                "severity_contribution": sev_contrib,
                "survival_contribution": surv_contrib,
                "waiting_contribution": wait_contrib,
            },
            "weights": {
                "weight_severity_pct": int(weights["weight_severity"] * 100),
                "weight_survival_pct": int(weights["weight_survival"] * 100),
                "weight_waiting_pct": int(weights["weight_waiting"] * 100),
            },
            "queue": {
                "total_patients": len(all_patients),
                "patient_above": {
                    "patient_id": patient_above.patient_id,
                    "rank": patient_above.rank,
                    "priority_score": round(patient_above.priority_score, 1),
                } if patient_above else None,
                "patient_below": {
                    "patient_id": patient_below.patient_id,
                    "rank": patient_below.rank,
                    "priority_score": round(patient_below.priority_score, 1),
                } if patient_below else None,
            }
        }
        return context

    def _dominant_contributor(self, contributions: Dict[str, float]) -> str:
        labels = {
            "severity_contribution": "Severity",
            "survival_contribution": "Survival Likelihood",
            "waiting_contribution": "Waiting Duration"
        }
        top_key = max(contributions, key=contributions.get)
        return labels.get(top_key, top_key)

    def ask_about_patient(self, patient_id: str, mode: str, free_question: str = "") -> Dict[str, Any]:
        """
        V3.1 — Patient-specific grounded explanation.
        mode: 'why_ranked' | 'drivers' | 'simple' | 'why_not_1' | 'free'
        """
        ctx = self.build_patient_context(patient_id)
        if not ctx:
            return {
                "status": "error",
                "message": f"Patient {patient_id} not found in the current CareGrid queue.",
                "source": "CareGrid Priority Engine"
            }

        p = ctx["patient"]
        c = ctx["contributions"]
        w = ctx["weights"]
        q = ctx["queue"]
        dominant = self._dominant_contributor(c)

        # Sort contributions for structured display
        contribs_sorted = sorted([
            ("Severity", c["severity_contribution"]),
            ("Survival Likelihood", c["survival_contribution"]),
            ("Waiting Duration", c["waiting_contribution"]),
        ], key=lambda x: x[1], reverse=True)

        # Attempt Gemini API Generation
        gemini_prompt = free_question if free_question else f"Explain why patient {patient_id} is ranked #{p.get('rank')} under mode '{mode}'."
        gemini_reply = self.call_gemini_api(gemini_prompt, PATIENT_SYSTEM_PROMPT, ctx)
        if gemini_reply:
            return {
                "status": "success",
                "patient_id": patient_id,
                "mode": mode,
                "answer": gemini_reply,
                "contributions": c,
                "patient_snapshot": p,
                "dominant_contributor": dominant,
                "source": "Gemini API | CareGrid Intelligence",
            }

        if mode == "why_ranked" or (mode == "free" and ("why" in free_question.lower() or "rank" in free_question.lower())):
            answer = (
                f"WHY THIS PATIENT?\n\n"
                f"Patient {p['patient_id']} is currently ranked #{p['rank']} with a CareGrid priority score of {p['priority_score']}.\n\n"
                f"SCORE EVIDENCE\n\n"
                f"Severity (SOFA-derived)\n"
                f"  Value: {p['severity']}\n"
                f"  Contribution: +{c['severity_contribution']} pts ({w['weight_severity_pct']}% weight)\n\n"
                f"Survival Likelihood\n"
                f"  Value: {p['survival_likelihood']}%\n"
                f"  Contribution: +{c['survival_contribution']} pts ({w['weight_survival_pct']}% weight)\n\n"
                f"Waiting Duration Equity\n"
                f"  Value: {p['waiting_time_minutes']} min\n"
                f"  Contribution: +{c['waiting_contribution']} pts ({w['weight_waiting_pct']}% weight)\n\n"
                f"INTERPRETATION\n\n"
                f"{dominant} is currently the largest contributor to Patient {p['patient_id']}'s calculated priority under the configured CareGrid weighting. "
                f"CareGrid currently classifies this patient as {p['patient_status']}.\n\n"
                f"SOURCE\n"
                f"CareGrid Current Patient State | CareGrid Priority Engine"
            )
            source = "CareGrid Current Patient State | CareGrid Priority Engine"

        elif mode == "drivers":
            answer = (
                f"WHAT DRIVES THIS PRIORITY?\n\n"
                f"Patient {p['patient_id']} — Priority Score: {p['priority_score']} — Rank #{p['rank']}\n\n"
            )
            labels = ["PRIMARY CONTRIBUTOR", "SECONDARY CONTRIBUTOR", "LOWER CONTRIBUTOR"]
            for i, (name, val) in enumerate(contribs_sorted):
                lbl = labels[i] if i < len(labels) else "CONTRIBUTOR"
                answer += f"{lbl}\n  {name}\n  +{val} points\n\n"
            answer += (
                f"Under the current CareGrid weighting ({w['weight_severity_pct']}% Severity / "
                f"{w['weight_survival_pct']}% Survival / {w['weight_waiting_pct']}% Waiting Duration), "
                f"{dominant} is the dominant contributor to this patient's priority score.\n\n"
                f"SOURCE\n"
                f"CareGrid Priority Engine"
            )
            source = "CareGrid Priority Engine"

        elif mode == "simple":
            second_name = contribs_sorted[1][0] if len(contribs_sorted) > 1 else ""
            answer = (
                f"Patient {p['patient_id']} is currently ranked #{p['rank']} in the CareGrid queue.\n\n"
                f"Their priority score of {p['priority_score']} is primarily driven by their {dominant.lower()} contribution ({contribs_sorted[0][1]} pts)"
                + (f", with {second_name.lower()} also contributing meaningfully ({contribs_sorted[1][1]} pts)." if second_name else ".") +
                f"\n\nCareGrid classifies this patient as {p['patient_status']}. "
                f"The score was calculated deterministically by the CareGrid Priority Engine — no clinical judgment is implied.\n\n"
                f"SOURCE\n"
                f"CareGrid Current Patient State"
            )
            source = "CareGrid Current Patient State"

        elif mode == "why_not_1":
            if p["rank"] == 1:
                answer = (
                    f"Patient {p['patient_id']} IS currently ranked #1 in the CareGrid queue with a priority score of {p['priority_score']}. "
                    f"No patient currently has a higher calculated priority score under the active CareGrid weighting.\n\n"
                    f"SOURCE\n"
                    f"CareGrid Priority Engine"
                )
            else:
                above = q.get("patient_above")
                score_gap = round(above["priority_score"] - p["priority_score"], 1) if above else "N/A"
                answer = (
                    f"WHY IS THIS PATIENT NOT RANKED #1?\n\n"
                    f"Under the current CareGrid scoring and ranking rules, Patient {p['patient_id']} is ranked #{p['rank']} "
                    f"with a calculated priority score of {p['priority_score']}.\n\n"
                )
                if above:
                    answer += (
                        f"The patient immediately above in the queue is {above['patient_id']} (Rank #{above['rank']}), "
                        f"who holds a higher calculated priority score of {above['priority_score']} — a difference of +{score_gap} points.\n\n"
                    )
                answer += (
                    f"The patients ranked above hold higher computed priority scores under the active weighting configuration "
                    f"({w['weight_severity_pct']}% Severity / {w['weight_survival_pct']}% Survival / {w['weight_waiting_pct']}% Waiting Duration). "
                    f"CareGrid has not made a clinical judgment; it has applied deterministic scoring consistently across all patients.\n\n"
                    f"SOURCE\n"
                    f"CareGrid Priority Engine | CareGrid Current Patient State"
                )
            source = "CareGrid Priority Engine | CareGrid Current Patient State"

        else:
            # Free-text fallback: return why_ranked as default
            answer = (
                f"Patient {p['patient_id']} is currently ranked #{p['rank']} with a priority score of {p['priority_score']}. "
                f"The score is composed of: Severity +{c['severity_contribution']} pts, Survival Likelihood +{c['survival_contribution']} pts, "
                f"Waiting Duration +{c['waiting_contribution']} pts. "
                f"The dominant contributor under the current CareGrid weighting is {dominant}. "
                f"Patient status: {p['patient_status']}.\n\n"
                f"SOURCE: CareGrid Current Patient State | CareGrid Priority Engine"
            )
            source = "CareGrid Current Patient State | CareGrid Priority Engine"

        return {
            "status": "success",
            "patient_id": patient_id,
            "mode": mode,
            "answer": answer,
            "contributions": c,
            "patient_snapshot": p,
            "dominant_contributor": dominant,
            "source": f"{source} (Deterministic Fallback)",
        }

    # ──────────────────────────────────────────────────────────────────────
    # V3.5 — AUDIT INTELLIGENCE & SMALL ATTENTION FOUNDATION
    # ──────────────────────────────────────────────────────────────────────

    def ask_audit(self, question: str, patient_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Process V3.5 Audit Intelligence query grounded strictly in live Audit Log events.
        """
        q_norm = question.strip().lower()
        audit_events = self.event_engine.audit_logger.get_events(limit=20) if hasattr(self.event_engine, "audit_logger") else []

        match = re.search(r'P-?\d+', question, re.IGNORECASE)
        mentioned_pid = match.group(0).upper() if match else None
        if mentioned_pid and not mentioned_pid.startswith("P-"):
            mentioned_pid = f"P-{mentioned_pid[1:]}"
        target_pid = mentioned_pid or patient_id

        # 1. PATIENT-SPECIFIC AUDIT / WHY DID PATIENT MOVE
        if target_pid or "this patient" in q_norm or "moved" in q_norm:
            pid = target_pid or (audit_events[0]["patient_id"] if audit_events and audit_events[0].get("patient_id") else None)
            patient_evts = [e for e in audit_events if e.get("patient_id") == pid] if pid else []

            # Attempt Gemini API Generation
            audit_ctx = {
                "target_patient_id": pid,
                "patient_audit_events": patient_evts[:10],
                "all_recent_audit_events": audit_events[:10]
            }
            gemini_reply = self.call_gemini_api(question, SYSTEM_PROMPT, audit_ctx)
            if gemini_reply:
                return {
                    "status": "success",
                    "question": question,
                    "answer": gemini_reply,
                    "source": "Gemini API | CareGrid Audit Intelligence"
                }

            lines = [f"PATIENT AUDIT TRACE — PATIENT {pid or 'N/A'}\n"]
            lines.append("RECENT ACTIVITY")

            if not patient_evts:
                lines.append("  No recent activity recorded for this patient in the active audit log.")
                lines.append("\nRANK CHANGE TRACE")
                lines.append("  Trigger information is unavailable in the current audit data.")
            else:
                for e in patient_evts[:5]:
                    lines.append(f"  • [{e.get('timestamp', 'N/A')[:19]}] {e.get('event_type', 'EVENT')}")
                    if e.get("previous_rank") and e.get("new_rank"):
                        lines.append(f"    Rank Shift: #{e['previous_rank']} → #{e['new_rank']} ({'+' if e.get('rank_delta',0)>0 else ''}{e.get('rank_delta',0)} positions)")
                    if e.get("reason"):
                        lines.append(f"    Reason: {e['reason']}")

                latest = patient_evts[0]
                lines.append("\nRANK CHANGE TRACE")
                lines.append("  TRIGGER")
                lines.append(f"  ↓ {latest.get('event_type', 'System Action')}")
                lines.append("  INPUT CHANGE")
                lines.append(f"  ↓ {latest.get('reason', 'Parameter / Queue update')}")
                lines.append("  PRIORITY RECALCULATION")
                lines.append("  ↓ CareGrid Priority Engine executed 50/30/20 deterministic scoring")
                lines.append("  RANK CHANGE")
                if latest.get("previous_rank") and latest.get("new_rank"):
                    lines.append(f"  ↓ #{latest['previous_rank']} → #{latest['new_rank']}")
                else:
                    lines.append("  ↓ Evaluated position updated")
                lines.append("  ARBITRATION")
                lines.append("  ↓ ICU Bed Arbitration Engine confirmed position")
                lines.append("  AUDIT RECORD")
                lines.append(f"  ↓ Event {latest.get('event_id', 'EVT')} logged to audit trail")

            lines.append("\nSOURCE\nCareGrid Audit Log | CareGrid Priority Engine")
            return {
                "status": "success",
                "question": question,
                "answer": "\n".join(lines),
                "source": "CareGrid Audit Log | CareGrid Priority Engine"
            }

        # 2. GENERAL RECENT AUDIT SUMMARY ("What changed recently?")
        lines = ["RECENT CAREGRID AUDIT CHANGES\n"]
        if not audit_events:
            lines.append("NO RECENT AUDIT EVENTS RECORDED IN THE SYSTEM.")
        else:
            for e in audit_events[:8]:
                ts = e.get("timestamp", "")[:19].replace("T", " ")
                pid_str = f"P-{e['patient_id']}" if e.get("patient_id") and not str(e.get("patient_id")).startswith("P-") else (e.get("patient_id") or "QUEUE")
                lines.append(f"• {ts} | {pid_str}")
                lines.append(f"  Event: {e.get('event_type', 'State Change')}")
                if e.get("previous_rank") and e.get("new_rank"):
                    lines.append(f"  Rank: #{e['previous_rank']} → #{e['new_rank']}")
                if e.get("reason"):
                    lines.append(f"  Details: {e['reason']}")
                lines.append("")

        lines.append("SOURCE\nCareGrid Audit Log")
        return {
            "status": "success",
            "question": question,
            "answer": "\n".join(lines),
            "source": "CareGrid Audit Log"
        }

    def detect_major_rank_changes(self, threshold: int = 2) -> List[Dict[str, Any]]:
        """
        V3.5 Small Attention Foundation: Deterministic Major Rank Change detection.
        Scans recent audit history for rank position shifts >= threshold.
        """
        audit_events = self.event_engine.audit_logger.get_events(limit=30) if hasattr(self.event_engine, "audit_logger") else []
        major_changes = []
        seen_pids = set()

        for evt in audit_events:
            delta = evt.get("rank_delta", 0)
            pid = evt.get("patient_id")
            if pid and abs(delta) >= threshold and pid not in seen_pids:
                seen_pids.add(pid)
                major_changes.append({
                    "patient_id": pid,
                    "previous_rank": evt.get("previous_rank"),
                    "new_rank": evt.get("new_rank"),
                    "rank_delta": delta,
                    "timestamp": evt.get("timestamp"),
                    "event_type": evt.get("event_type"),
                    "reason": evt.get("reason"),
                    "threshold": threshold
                })
        return major_changes

    def explain_major_rank_change(self, patient_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Grounded AI explanation of why a Major Rank Change attention indicator was surfaced.
        """
        changes = self.detect_major_rank_changes()
        target = next((c for c in changes if c["patient_id"] == patient_id), None) if patient_id else (changes[0] if changes else None)

        lines = ["ATTENTION EXPLANATION: MAJOR RANK CHANGE\n"]
        lines.append("WHY IS THIS FLAGGED?")

        if not target:
            lines.append("NO MAJOR RANK CHANGES")
            lines.append("No major rank changes (≥ 2 rank position shifts) are currently recorded in the active audit history.")
        else:
            pid = target["patient_id"]
            prev_r = target["previous_rank"]
            new_r = target["new_rank"]
            delta = target["rank_delta"]
            lines.append(
                f"This is flagged as a Major Rank Change because Patient {pid} shifted from Rank #{prev_r} → #{new_r} "
                f"({'+' if delta > 0 else ''}{delta} positions), meeting the configured operational threshold of ≥ {target['threshold']} position shifts.\n\n"
                f"TRIGGER DETAILS\n"
                f"• Event: {target['event_type']}\n"
                f"• Details: {target['reason']}\n"
                f"• Timestamp: {target['timestamp'][:19]}\n\n"
                f"CareGrid surfaced this indicator deterministically from the Audit Log. No clinical judgment or prediction is implied."
            )

        lines.append("\nSOURCE\nCareGrid Audit Log | CareGrid Priority Engine")
        return {
            "status": "success",
            "answer": "\n".join(lines),
            "source": "CareGrid Audit Log | CareGrid Priority Engine"
        }

    def explain_attention_signal(self, signal: Dict[str, Any]) -> Dict[str, Any]:
        """
        Grounded AI explanation of any V4.0 deterministic Attention Signal.
        """
        sig_type = signal.get("signal_type", "ATTENTION_SIGNAL")
        prompt = f"Explain why operational attention signal '{sig_type}' was surfaced."
        gemini_reply = self.call_gemini_api(prompt, SYSTEM_PROMPT, signal)
        if gemini_reply:
            return {
                "status": "success",
                "answer": gemini_reply,
                "source": "Gemini API | CareGrid Attention Intelligence"
            }

        lines = [f"ATTENTION SIGNAL EXPLANATION: {sig_type.replace('_', ' ')}\n"]
        lines.append("WHY IS THIS FLAGGED?")

        if sig_type == "NEAR_TIE":
            pid_a = signal.get("patient_id_a", "N/A")
            pid_b = signal.get("patient_id_b", "N/A")
            diff = signal.get("score_diff", 0.0)
            lines.append(
                f"These patients have closely matched priority scores (Gap: {diff} pts) under the current CareGrid configuration.\n\n"
                f"• Patient {pid_a}: Rank #{signal.get('rank_a')}, Priority Score {signal.get('score_a')}\n"
                f"• Patient {pid_b}: Rank #{signal.get('rank_b')}, Priority Score {signal.get('score_b')}\n\n"
                f"OPERATIONAL RULE\n"
                f"Score separation is within the configured near-tie threshold of ≤ 1.0 points. "
                f"CareGrid highlights closely matched candidates so clinicians can review physiological score breakdown side-by-side."
            )
        elif sig_type == "MAJOR_RANK_CHANGE":
            pid = signal.get("patient_id", "N/A")
            prev_r = signal.get("previous_rank", "?")
            new_r = signal.get("new_rank", "?")
            delta = signal.get("rank_delta", 0)
            lines.append(
                f"Patient {pid} experienced a major rank position shift from Rank #{prev_r} → #{new_r} ({'+' if delta > 0 else ''}{delta} positions).\n\n"
                f"OPERATIONAL RULE\n"
                f"Rank position delta meets or exceeds the operational attention threshold of ≥ 2 position shifts."
            )
        elif sig_type == "WAITING_TIME_ATTENTION":
            pid = signal.get("patient_id", "N/A")
            wait_m = signal.get("waiting_time_minutes", 0)
            thresh = signal.get("threshold", 120)
            lines.append(
                f"Patient {pid} waiting duration ({wait_m} min) exceeds the configured operational attention threshold of ≥ {thresh} minutes.\n\n"
                f"OPERATIONAL RULE\n"
                f"Extended wait time is surfaced deterministically to ensure queue equity and prevent prolonged pending status."
            )
        elif sig_type == "CRITICAL_QUEUE_LOAD":
            cnt = signal.get("count", 0)
            thresh = signal.get("threshold", 5)
            lines.append(
                f"This is flagged as Critical Queue Load because {cnt} critical severity patients (SOFA severity ≥ 70.0) are currently present out of 3600 total records, meeting the operational threshold of ≥ {thresh} critical candidates.\n\n"
                f"OPERATIONAL RULE\n"
                f"High critical load requires ICU capacity review to manage impending bed allocation demand."
            )
        else:
            lines.append(signal.get("description", "Deterministic operational signal surfaced by CareGrid Attention Engine."))

        lines.append("\nSOURCE\nCareGrid Current State | CareGrid Attention Engine")
        return {
            "status": "success",
            "answer": "\n".join(lines),
            "source": "CareGrid Current State | CareGrid Attention Engine"
        }

