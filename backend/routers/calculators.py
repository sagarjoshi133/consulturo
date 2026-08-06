"""ConsultUro — calculators router.

  · /api/calculators

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("/api/calculators")
async def list_calculators():
    return [
        {"id": "ipss", "name": "IPSS", "category": "Prostate", "description": "7-item score with history tracking."},
        {"id": "psa-density", "name": "PSA Density", "category": "Prostate", "description": "PSA ÷ prostate volume."},
        {"id": "egfr", "name": "eGFR (CKD-EPI 2021)", "category": "Kidney", "description": "Estimate GFR from creatinine."},
        {"id": "bmi", "name": "BMI", "category": "General", "description": "Body-mass index."},
        {"id": "iief5", "name": "IIEF-5", "category": "Sexual Health", "description": "5-item erectile function score."},
        {"id": "prostate-volume", "name": "Prostate Volume", "category": "Prostate", "description": "Ellipsoid formula (0.524 × L × W × H)."},
        {"id": "crcl", "name": "Creatinine Clearance", "category": "Kidney", "description": "Cockcroft-Gault formula."},
        {"id": "stone-risk", "name": "Stone Passage Predictor", "category": "Stones", "description": "Estimate spontaneous passage %."},
    ]
