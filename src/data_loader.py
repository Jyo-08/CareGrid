"""
CareGrid V1 - Data Loader Module
Centralized data-loading layer that reads ONLY raw CSV files:
- data/raw/X_train_2025.csv
- data/raw/patients.csv

Handles missing values and invalid rows gracefully.
"""

import os
import csv
import math
from typing import List, Dict, Any, Optional
from src.patient_model import Patient


REQUIRED_FILES = {
    "x_train": "data/raw/X_train_2025.csv",
    "patients": "data/raw/patients.csv"
}

ALLOWED_RAW_FILES = {"x_train_2025.csv", "patients.csv"}


def safe_float(val: Any, default: Optional[float] = 0.0) -> Optional[float]:
    """Safely converts input to float, returning default if invalid or missing."""
    if val is None or val == "" or str(val).strip().lower() in ("nan", "null", "none", "-1", "-1.0"):
        return default
    try:
        f = float(val)
        return default if math.isnan(f) else f
    except (ValueError, TypeError):
        return default


def safe_int(val: Any, default: int = 0) -> int:
    """Safely converts input to int."""
    if val is None or val == "":
        return default
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default


class DataLoader:
    def __init__(self, base_dir: Optional[str] = None):
        if base_dir is None:
            base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.base_dir = base_dir
        self.x_train_path = os.path.join(self.base_dir, REQUIRED_FILES["x_train"])
        self.patients_path = os.path.join(self.base_dir, REQUIRED_FILES["patients"])

    def verify_files_exist(self) -> bool:
        """Verifies required CSV files exist and only allowed CSV files are present."""
        if not os.path.exists(self.x_train_path):
            raise FileNotFoundError(f"Required dataset missing: {self.x_train_path}")
        if not os.path.exists(self.patients_path):
            raise FileNotFoundError(f"Required dataset missing: {self.patients_path}")
        
        # Verify raw folder contains only allowed files
        raw_dir = os.path.join(self.base_dir, "data/raw")
        if os.path.exists(raw_dir):
            for filename in os.listdir(raw_dir):
                if filename.startswith(".") or not filename.endswith(".csv"):
                    continue
                if filename.lower() not in ALLOWED_RAW_FILES:
                    raise RuntimeError(f"Unallowed dataset file found in data/raw: {filename}")
        return True

    def load_patients_demographics(self) -> List[Dict[str, Any]]:
        """Reads patients.csv demographics."""
        demographics = []
        if not os.path.exists(self.patients_path):
            return demographics

        with open(self.patients_path, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                demographics.append({
                    "patient_id": row.get("patient_id", "").strip(),
                    "name": row.get("name", "Unknown").strip(),
                    "age": safe_float(row.get("age")),
                    "arrival_date": row.get("arrival_date", "2025-03-16").strip(),
                    "departure_date": row.get("departure_date", "").strip(),
                    "service": row.get("service", "ICU").strip(),
                    "satisfaction": safe_float(row.get("satisfaction"))
                })
        return demographics

    def load_patients(self, limit: Optional[int] = None) -> List[Patient]:
        """
        Loads X_train_2025.csv and joins with patients.csv to construct Patient models.
        """
        self.verify_files_exist()

        demographics_list = self.load_patients_demographics()
        demo_count = len(demographics_list)

        patients: List[Patient] = []

        with open(self.x_train_path, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            idx = 0
            for row in reader:
                if limit and idx >= limit:
                    break

                record_id = row.get("recordid", "").strip()
                if not record_id:
                    continue

                # Raw SOFA score
                raw_sofa = safe_float(row.get("SOFA"), default=0.0)

                # Clinical parameters
                saps_i = safe_float(row.get("SAPS-I"))
                gcs = safe_float(row.get("GCS_first"))
                hr = safe_float(row.get("HR_first"))
                map_val = safe_float(row.get("MAP_first"))
                sao2 = safe_float(row.get("SaO2_first"))
                creatinine = safe_float(row.get("Creatinine_first"))
                wbc = safe_float(row.get("WBC_first"))
                lactate = safe_float(row.get("Lactate_first"))
                urine = safe_float(row.get("UrineOutputSum"))
                sysabp = safe_float(row.get("SysABP_first"))

                raw_params = {
                    "SOFA": raw_sofa,
                    "SAPS-I": saps_i,
                    "GCS_first": gcs,
                    "HR_first": hr,
                    "MAP_first": map_val,
                    "SaO2_first": sao2,
                    "Creatinine_first": creatinine,
                    "WBC_first": wbc,
                    "Lactate_first": lactate,
                    "UrineOutputSum": urine,
                    "SysABP_first": sysabp
                }

                # Map demographics if available
                demo_info = demographics_list[idx % demo_count] if demo_count > 0 else {}
                name = demo_info.get("name", f"Patient {record_id}")
                age = safe_float(row.get("Age")) or demo_info.get("age") or 50.0
                arrival_date = demo_info.get("arrival_date", "2025-03-16")
                service = demo_info.get("service", "ICU")

                # Deterministic simulation of V1 fields (survival likelihood & wait time)
                # Seeded deterministically using record_id integer
                rec_num = safe_int(record_id, default=100000)
                
                # Survival likelihood: 50.0 to 98.0 deterministic value based on SAPS-I or rec_num
                if saps_i is not None and saps_i > 0:
                    sim_survival = max(30.0, min(98.0, 100.0 - (saps_i * 3.5)))
                else:
                    sim_survival = 50.0 + ((rec_num * 17) % 45)

                # Waiting time: 15 to 180 minutes deterministic value
                sim_wait_minutes = 15 + ((rec_num * 31) % 150)

                # Status: Waiting (default for priority queue) or Admitted/Critical
                statuses = ["Waiting", "Waiting", "Waiting", "Critical", "Admitted"]
                sim_status = statuses[(rec_num) % len(statuses)]

                patient = Patient(
                    record_id=record_id,
                    sofa_score=raw_sofa,
                    survival_likelihood=sim_survival,
                    waiting_time_minutes=sim_wait_minutes,
                    arrival_time=arrival_date,
                    patient_status=sim_status,
                    name=name,
                    age=age,
                    service=service,
                    raw_clinical_params=raw_params
                )

                patients.append(patient)
                idx += 1

        return patients
