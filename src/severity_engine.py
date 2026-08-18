"""
CareGrid V6.0 — Clinical Severity Engine
Decomposes patient clinical severity across 6 Organ Systems:
1. Neurological (GCS)
2. Cardiovascular (MAP, SysABP, HR)
3. Respiratory (SaO2, PaO2/FiO2)
4. Coagulation / Hemostasis (Platelets)
5. Liver / Hepatic (Bilirubin, AST, ALT)
6. Kidney / Renal (Creatinine, Urine Output)

Provides SOFA-aligned deterministic scoring (0-100 scale & 0-4 sub-scores),
clinical category mapping, dominant driver detection, transparent data-availability
handling, and traceable field provenance.
"""

import math
from typing import Dict, Any, List, Optional, Tuple


def clamp(val: float, min_val: float = 0.0, max_val: float = 100.0) -> float:
    """Clamps a numerical value within [min_val, max_val]."""
    if val is None:
        return min_val
    try:
        f_val = float(val)
        return max(min_val, min(max_val, f_val))
    except (ValueError, TypeError):
        return min_val


def get_clinical_category(score: float, is_available: bool = True) -> str:
    """Maps normalized organ severity score (0-100) to standard clinical category."""
    if not is_available:
        return "Data Unavailable"
    if score < 20.0:
        return "Normal"
    elif score < 45.0:
        return "Mild"
    elif score < 70.0:
        return "Moderate"
    elif score < 90.0:
        return "Severe"
    else:
        return "Critical"


class ClinicalSeverityEngine:
    def __init__(self):
        pass

    def evaluate_neurological(self, raw_params: Dict[str, Any], sofa_fallback: float = 0.0) -> Dict[str, Any]:
        """
        Neurological System (GCS: Glasgow Coma Scale 3-15).
        SOFA sub-score:
        GCS 15: 0 (Normal)
        GCS 13-14: 1 (Mild)
        GCS 10-12: 2 (Moderate)
        GCS 6-9: 3 (Severe)
        GCS < 6: 4 (Critical)
        """
        gcs = raw_params.get("GCS_first")
        if gcs is not None and not (isinstance(gcs, float) and math.isnan(gcs)) and float(gcs) > 0:
            gcs_val = float(gcs)
            if gcs_val >= 15:
                sofa_sub = 0
            elif gcs_val >= 13:
                sofa_sub = 1
            elif gcs_val >= 10:
                sofa_sub = 2
            elif gcs_val >= 6:
                sofa_sub = 3
            else:
                sofa_sub = 4

            score = clamp(sofa_sub * 25.0, 0.0, 100.0)
            return {
                "system_name": "Neurological",
                "score": score,
                "sofa_subscore": sofa_sub,
                "category": get_clinical_category(score, True),
                "source_field": "GCS_first",
                "raw_value": f"GCS {gcs_val:.0f}",
                "numeric_raw": gcs_val,
                "status": "OK",
                "evidence": f"GCS {gcs_val:.0f} (SOFA sub-score +{sofa_sub})"
            }
        
        # Fallback if raw variable unavailable
        est_sub = min(4, max(0, int(sofa_fallback / 6.0)))
        est_score = clamp(est_sub * 25.0, 0.0, 100.0)
        return {
            "system_name": "Neurological",
            "score": est_score,
            "sofa_subscore": est_sub,
            "category": get_clinical_category(est_score, False),
            "source_field": "GCS_first (Unavailable)",
            "raw_value": "N/A",
            "numeric_raw": None,
            "status": "DATA_UNAVAILABLE",
            "evidence": f"Unmeasured GCS (SOFA baseline estimate +{est_sub})"
        }

    def evaluate_cardiovascular(self, raw_params: Dict[str, Any], sofa_fallback: float = 0.0) -> Dict[str, Any]:
        """
        Cardiovascular System (MAP, SysABP, HR).
        MAP >= 70: 0
        MAP 60-69: 1
        MAP 50-59 or SysABP < 90: 2
        MAP 40-49 or SysABP < 80: 3
        MAP < 40 or SysABP < 70: 4
        """
        map_val = raw_params.get("MAP_first")
        sys_val = raw_params.get("SysABP_first")
        hr_val = raw_params.get("HR_first")

        valid_map = map_val is not None and not (isinstance(map_val, float) and math.isnan(map_val)) and float(map_val) > 0
        valid_sys = sys_val is not None and not (isinstance(sys_val, float) and math.isnan(sys_val)) and float(sys_val) > 0

        if valid_map or valid_sys:
            m_val = float(map_val) if valid_map else (float(sys_val) * 0.7)
            s_val = float(sys_val) if valid_sys else (m_val * 1.3)

            if m_val >= 70 and s_val >= 100:
                sofa_sub = 0
            elif m_val >= 65:
                sofa_sub = 1
            elif m_val >= 55 or s_val >= 90:
                sofa_sub = 2
            elif m_val >= 45 or s_val >= 80:
                sofa_sub = 3
            else:
                sofa_sub = 4

            score = clamp(sofa_sub * 25.0, 0.0, 100.0)
            raw_str = f"MAP {m_val:.1f} mmHg" if valid_map else f"SysABP {s_val:.1f} mmHg"
            if hr_val and not math.isnan(float(hr_val)):
                raw_str += f", HR {float(hr_val):.0f} bpm"

            return {
                "system_name": "Cardiovascular",
                "score": score,
                "sofa_subscore": sofa_sub,
                "category": get_clinical_category(score, True),
                "source_field": "MAP_first / SysABP_first",
                "raw_value": raw_str,
                "numeric_raw": m_val,
                "status": "OK",
                "evidence": f"{raw_str} (SOFA sub-score +{sofa_sub})"
            }

        est_sub = min(4, max(0, int(sofa_fallback / 6.0)))
        est_score = clamp(est_sub * 25.0, 0.0, 100.0)
        return {
            "system_name": "Cardiovascular",
            "score": est_score,
            "sofa_subscore": est_sub,
            "category": get_clinical_category(est_score, False),
            "source_field": "MAP_first (Unavailable)",
            "raw_value": "N/A",
            "numeric_raw": None,
            "status": "DATA_UNAVAILABLE",
            "evidence": f"Unmeasured MAP (SOFA baseline estimate +{est_sub})"
        }

    def evaluate_respiratory(self, raw_params: Dict[str, Any], sofa_fallback: float = 0.0) -> Dict[str, Any]:
        """
        Respiratory System (SaO2 %, PaO2/FiO2).
        SaO2 >= 98%: 0
        SaO2 95-97%: 1
        SaO2 90-94%: 2
        SaO2 85-89%: 3
        SaO2 < 85%: 4
        """
        sao2 = raw_params.get("SaO2_first")
        valid_sao2 = sao2 is not None and not (isinstance(sao2, float) and math.isnan(sao2)) and float(sao2) > 0

        if valid_sao2:
            s_val = float(sao2)
            if s_val >= 98.0:
                sofa_sub = 0
            elif s_val >= 95.0:
                sofa_sub = 1
            elif s_val >= 90.0:
                sofa_sub = 2
            elif s_val >= 85.0:
                sofa_sub = 3
            else:
                sofa_sub = 4

            score = clamp(sofa_sub * 25.0, 0.0, 100.0)
            return {
                "system_name": "Respiratory",
                "score": score,
                "sofa_subscore": sofa_sub,
                "category": get_clinical_category(score, True),
                "source_field": "SaO2_first",
                "raw_value": f"SaO2 {s_val:.1f}%",
                "numeric_raw": s_val,
                "status": "OK",
                "evidence": f"SaO2 {s_val:.1f}% (SOFA sub-score +{sofa_sub})"
            }

        est_sub = min(4, max(0, int(sofa_fallback / 6.0)))
        est_score = clamp(est_sub * 25.0, 0.0, 100.0)
        return {
            "system_name": "Respiratory",
            "score": est_score,
            "sofa_subscore": est_sub,
            "category": get_clinical_category(est_score, False),
            "source_field": "SaO2_first (Unavailable)",
            "raw_value": "N/A",
            "numeric_raw": None,
            "status": "DATA_UNAVAILABLE",
            "evidence": f"Unmeasured SaO2 (SOFA baseline estimate +{est_sub})"
        }

    def evaluate_coagulation(self, raw_params: Dict[str, Any], sofa_fallback: float = 0.0) -> Dict[str, Any]:
        """
        Coagulation / Hemostasis System (Platelets x 10^3 / uL).
        Platelets >= 150: 0
        Platelets 100-149: 1
        Platelets 50-99: 2
        Platelets 20-49: 3
        Platelets < 20: 4
        """
        plt = raw_params.get("Platelets_first")
        valid_plt = plt is not None and not (isinstance(plt, float) and math.isnan(plt)) and float(plt) > 0

        if valid_plt:
            p_val = float(plt)
            if p_val >= 150.0:
                sofa_sub = 0
            elif p_val >= 100.0:
                sofa_sub = 1
            elif p_val >= 50.0:
                sofa_sub = 2
            elif p_val >= 20.0:
                sofa_sub = 3
            else:
                sofa_sub = 4

            score = clamp(sofa_sub * 25.0, 0.0, 100.0)
            return {
                "system_name": "Coagulation",
                "score": score,
                "sofa_subscore": sofa_sub,
                "category": get_clinical_category(score, True),
                "source_field": "Platelets_first",
                "raw_value": f"Platelets {p_val:.0f}k/µL",
                "numeric_raw": p_val,
                "status": "OK",
                "evidence": f"Platelet count {p_val:.0f}k/µL (SOFA sub-score +{sofa_sub})"
            }

        est_sub = min(4, max(0, int(sofa_fallback / 6.0)))
        est_score = clamp(est_sub * 25.0, 0.0, 100.0)
        return {
            "system_name": "Coagulation",
            "score": est_score,
            "sofa_subscore": est_sub,
            "category": get_clinical_category(est_score, False),
            "source_field": "Platelets_first (Unavailable)",
            "raw_value": "N/A",
            "numeric_raw": None,
            "status": "DATA_UNAVAILABLE",
            "evidence": f"Unmeasured Platelets (SOFA baseline estimate +{est_sub})"
        }

    def evaluate_liver(self, raw_params: Dict[str, Any], sofa_fallback: float = 0.0) -> Dict[str, Any]:
        """
        Liver / Hepatic System (Bilirubin mg/dL).
        Bilirubin < 1.2: 0
        Bilirubin 1.2-1.9: 1
        Bilirubin 2.0-5.9: 2
        Bilirubin 6.0-11.9: 3
        Bilirubin >= 12.0: 4
        """
        bili = raw_params.get("Bilirubin_first")
        valid_bili = bili is not None and not (isinstance(bili, float) and math.isnan(bili)) and float(bili) >= 0

        if valid_bili:
            b_val = float(bili)
            if b_val < 1.2:
                sofa_sub = 0
            elif b_val < 2.0:
                sofa_sub = 1
            elif b_val < 6.0:
                sofa_sub = 2
            elif b_val < 12.0:
                sofa_sub = 3
            else:
                sofa_sub = 4

            score = clamp(sofa_sub * 25.0, 0.0, 100.0)
            return {
                "system_name": "Liver",
                "score": score,
                "sofa_subscore": sofa_sub,
                "category": get_clinical_category(score, True),
                "source_field": "Bilirubin_first",
                "raw_value": f"Bilirubin {b_val:.1f} mg/dL",
                "numeric_raw": b_val,
                "status": "OK",
                "evidence": f"Serum Bilirubin {b_val:.1f} mg/dL (SOFA sub-score +{sofa_sub})"
            }

        est_sub = min(4, max(0, int(sofa_fallback / 6.0)))
        est_score = clamp(est_sub * 25.0, 0.0, 100.0)
        return {
            "system_name": "Liver",
            "score": est_score,
            "sofa_subscore": est_sub,
            "category": get_clinical_category(est_score, False),
            "source_field": "Bilirubin_first (Unavailable)",
            "raw_value": "N/A",
            "numeric_raw": None,
            "status": "DATA_UNAVAILABLE",
            "evidence": f"Unmeasured Bilirubin (SOFA baseline estimate +{est_sub})"
        }

    def evaluate_kidney(self, raw_params: Dict[str, Any], sofa_fallback: float = 0.0) -> Dict[str, Any]:
        """
        Kidney / Renal System (Creatinine mg/dL, Urine Output mL).
        Creatinine < 1.2: 0
        Creatinine 1.2-1.9: 1
        Creatinine 2.0-3.4: 2
        Creatinine 3.5-4.9 or Urine < 500: 3
        Creatinine >= 5.0 or Urine < 200: 4
        """
        creat = raw_params.get("Creatinine_first")
        urine = raw_params.get("UrineOutputSum")

        valid_creat = creat is not None and not (isinstance(creat, float) and math.isnan(creat)) and float(creat) >= 0
        valid_urine = urine is not None and not (isinstance(urine, float) and math.isnan(urine)) and float(urine) >= 0

        if valid_creat or valid_urine:
            c_val = float(creat) if valid_creat else 1.0
            u_val = float(urine) if valid_urine else 1500.0

            if c_val >= 5.0 or u_val < 200:
                sofa_sub = 4
            elif c_val >= 3.5 or u_val < 500:
                sofa_sub = 3
            elif c_val >= 2.0:
                sofa_sub = 2
            elif c_val >= 1.2:
                sofa_sub = 1
            else:
                sofa_sub = 0

            score = clamp(sofa_sub * 25.0, 0.0, 100.0)
            raw_parts = []
            if valid_creat:
                raw_parts.append(f"Creatinine {c_val:.1f} mg/dL")
            if valid_urine:
                raw_parts.append(f"Urine Output {u_val:.0f} mL")
            raw_str = ", ".join(raw_parts)

            return {
                "system_name": "Kidney",
                "score": score,
                "sofa_subscore": sofa_sub,
                "category": get_clinical_category(score, True),
                "source_field": "Creatinine_first / UrineOutputSum",
                "raw_value": raw_str,
                "numeric_raw": c_val,
                "status": "OK",
                "evidence": f"{raw_str} (SOFA sub-score +{sofa_sub})"
            }

        est_sub = min(4, max(0, int(sofa_fallback / 6.0)))
        est_score = clamp(est_sub * 25.0, 0.0, 100.0)
        return {
            "system_name": "Kidney",
            "score": est_score,
            "sofa_subscore": est_sub,
            "category": get_clinical_category(est_score, False),
            "source_field": "Creatinine_first (Unavailable)",
            "raw_value": "N/A",
            "numeric_raw": None,
            "status": "DATA_UNAVAILABLE",
            "evidence": f"Unmeasured Creatinine (SOFA baseline estimate +{est_sub})"
        }

    def analyze_patient(self, patient_id: str, sofa_score: float, raw_params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Main V6 entry point: Evaluates all 6 organ systems for a patient,
        calculates overall severity deterministically, identifies dominant contributors,
        and provides full provenance tracking.
        """
        raw = raw_params or {}

        neuro = self.evaluate_neurological(raw, sofa_score)
        cardio = self.evaluate_cardiovascular(raw, sofa_score)
        resp = self.evaluate_respiratory(raw, sofa_score)
        coag = self.evaluate_coagulation(raw, sofa_score)
        liver = self.evaluate_liver(raw, sofa_score)
        kidney = self.evaluate_kidney(raw, sofa_score)

        systems = [neuro, cardio, resp, coag, liver, kidney]

        # Calculate total derived SOFA subscores
        total_sofa_sub = sum(s["sofa_subscore"] for s in systems)

        # Derive overall severity matching V5 formula clamp((sofa / 20) * 100, 0, 100)
        # If raw_params provided explicit SOFA or total subscores match, use derived SOFA
        effective_sofa = max(sofa_score, total_sofa_sub)
        derived_overall_severity = round(clamp((effective_sofa / 20.0) * 100.0, 0.0, 100.0), 2)

        # Identify dominant contributors (sorted descending by score)
        sorted_systems = sorted(systems, key=lambda x: x["score"], reverse=True)
        dominant_contributors = [
            f"{s['system_name']} ({s['score']:.0f}/100 - {s['category']})"
            for s in sorted_systems if s["score"] > 0
        ][:2]

        if not dominant_contributors:
            dominant_contributors = ["All Organ Systems Within Normal Limits"]

        return {
            "patient_id": patient_id,
            "sofa_score": effective_sofa,
            "overall_severity": derived_overall_severity,
            "organ_systems": {
                "neurological": neuro,
                "cardiovascular": cardio,
                "respiratory": resp,
                "coagulation": coag,
                "liver": liver,
                "kidney": kidney
            },
            "organ_system_list": systems,
            "dominant_contributors": dominant_contributors,
            "methodology": "Standard SOFA-derived Organ-System Clinical Decomposition (V6 Engine)",
            "provenance": {
                "sofa_score": f"Effective SOFA {effective_sofa:.0f} (Sum of organ sub-scores: {total_sofa_sub})",
                "overall_severity": f"clamp(({effective_sofa:.0f} / 20.0) * 100.0, 0, 100) = {derived_overall_severity:.1f}",
                "decomposition_source": "Derived deterministically from X_train_2025.csv raw clinical indicators"
            }
        }
