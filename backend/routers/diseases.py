"""ConsultUro — Diseases router.

GET /api/diseases             — localized list (en/hi/gu)
GET /api/diseases/{id}        — localized detail

The DISEASES image map lives here so the homepage hero banners stay
visually unique per condition. The actual content (titles, symptoms,
causes, treatments) is sourced from disease_content.py which already
handles trilingual translation.

Extracted from server.py during Phase 2 modularization. Behaviour
preserved EXACTLY.
"""
from typing import Dict
from fastapi import APIRouter, HTTPException

from disease_content import (
    list_localized as _dis_list_localized,
    get_localized as _dis_get_localized,
)

router = APIRouter()


# Category-based image URLs used on the disease detail hero banners.
# Sourced from professional Unsplash/Pexels medical stock imagery.
_IMG_KIDNEY = "https://images.pexels.com/photos/18272488/pexels-photo-18272488.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_PROSTATE = "https://images.unsplash.com/photo-1638202993928-7267aad84c31?auto=format&fit=crop&w=1200&q=70"
_IMG_BLADDER = "https://images.pexels.com/photos/18272488/pexels-photo-18272488.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_MALE = "https://images.unsplash.com/photo-1768644675767-40b294727e10?auto=format&fit=crop&w=1200&q=70"
_IMG_CONSULT = "https://images.unsplash.com/photo-1666214277730-e9c7e755e5a3?auto=format&fit=crop&w=1200&q=70"
_IMG_SURGERY = "https://images.pexels.com/photos/7108257/pexels-photo-7108257.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_LAB = "https://images.pexels.com/photos/7723391/pexels-photo-7723391.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_DOCTOR = "https://images.pexels.com/photos/8376222/pexels-photo-8376222.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_ANATOMY = "https://images.pexels.com/photos/30133402/pexels-photo-30133402.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_URINE_SAMPLE = "https://images.unsplash.com/photo-1585583983067-a7535737691f?auto=format&fit=crop&w=1200&q=70"
_IMG_SPECIMEN = "https://images.unsplash.com/photo-1584028377143-21f876eb9c1e?auto=format&fit=crop&w=1200&q=70"
_IMG_HEALTH_SAMPLE = "https://images.pexels.com/photos/24193876/pexels-photo-24193876.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_TEST_TUBES = "https://images.pexels.com/photos/8442376/pexels-photo-8442376.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_USG_IMAGES = "https://images.pexels.com/photos/6463624/pexels-photo-6463624.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_USG_MONITOR = "https://images.pexels.com/photos/7089623/pexels-photo-7089623.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_MICROSCOPE = "https://images.unsplash.com/photo-1526930382372-67bf22c0fce2?auto=format&fit=crop&w=1200&q=70"
_IMG_DR_CONSULT = "https://images.unsplash.com/photo-1536064479547-7ee40b74b807?auto=format&fit=crop&w=1200&q=70"
_IMG_DR_USG = "https://images.pexels.com/photos/7089394/pexels-photo-7089394.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_DR_TABLET = "https://images.pexels.com/photos/5327864/pexels-photo-5327864.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_DR_TESTTUBE = "https://images.unsplash.com/photo-1579165466991-467135ad3110?auto=format&fit=crop&w=1200&q=70"
_IMG_DR_COAT = "https://images.pexels.com/photos/4309557/pexels-photo-4309557.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_STETHO_CLOSE = "https://images.pexels.com/photos/20100299/pexels-photo-20100299.jpeg?auto=compress&cs=tinysrgb&w=1200"

DISEASE_IMAGE_MAP: Dict[str, str] = {
    # Kidney & stone disease
    "kidney-stones": _IMG_KIDNEY,
    "ureteric-stricture": _IMG_USG_MONITOR,
    "hydronephrosis": _IMG_USG_IMAGES,
    "puj-obstruction": _IMG_SURGERY,
    "kidney-cancer": _IMG_USG_MONITOR,
    "ckd": _IMG_DR_TABLET,
    "aki": _IMG_STETHO_CLOSE,
    "pcos-kidney": _IMG_DR_USG,
    # Prostate
    "bph-prostate": _IMG_PROSTATE,
    "prostate-cancer": _IMG_MICROSCOPE,
    # Bladder
    "bladder-cancer": _IMG_USG_MONITOR,
    "overactive-bladder": _IMG_BLADDER,
    "interstitial-cystitis": _IMG_DR_COAT,
    "neurogenic-bladder": _IMG_ANATOMY,
    # Urinary tract / UTI / hematuria
    "uti": _IMG_URINE_SAMPLE,
    "hematuria": _IMG_SPECIMEN,
    "urethral-stricture": _IMG_MICROSCOPE,
    # Incontinence
    "incontinence": _IMG_DR_CONSULT,
    "stress-incontinence": _IMG_DR_TESTTUBE,
    "nocturnal-enuresis": _IMG_DR_TABLET,
    # Male sexual / andrology
    "erectile-dysfunction": _IMG_CONSULT,
    "male-infertility": _IMG_TEST_TUBES,
    "peyronies": _IMG_HEALTH_SAMPLE,
    "priapism": _IMG_STETHO_CLOSE,
    # Scrotal / paediatric
    "testicular-cancer": _IMG_DR_COAT,
    "phimosis": _IMG_DR_CONSULT,
    "hydrocele": _IMG_HEALTH_SAMPLE,
    "varicocele": _IMG_USG_IMAGES,
    "undescended-testis": _IMG_DR_USG,
    # Procedures
    "kidney-transplant": _IMG_SURGERY,
    # Additional conditions
    "prostatitis": _IMG_DR_USG,
    "pmph": _IMG_PROSTATE,
    "neobladder": _IMG_SURGERY,
    "female-urology": _IMG_DR_CONSULT,
    "paediatric-urology": _IMG_DR_USG,
    "vur": _IMG_USG_IMAGES,
    "hypospadias": _IMG_DR_COAT,
    "paraphimosis": _IMG_DR_CONSULT,
    "overactive-kidney-cyst": _IMG_USG_MONITOR,
    "androgen-deficiency": _IMG_TEST_TUBES,
    "hematospermia": _IMG_SPECIMEN,
}

_DEFAULT_DISEASE_IMAGE = _IMG_CONSULT


def disease_image(did: str) -> str:
    return DISEASE_IMAGE_MAP.get(did, _DEFAULT_DISEASE_IMAGE)


@router.get("/api/diseases")
async def list_diseases(lang: str = "en"):
    if lang not in ("en", "hi", "gu"):
        lang = "en"
    items = _dis_list_localized(lang)
    return [
        {
            "id": d["id"],
            "name": d["name"],
            "icon": d["icon"],
            "tagline": d["tagline"],
            "image_url": disease_image(d["id"]),
        }
        for d in items
    ]


@router.get("/api/diseases/{disease_id}")
async def get_disease(disease_id: str, lang: str = "en"):
    if lang not in ("en", "hi", "gu"):
        lang = "en"
    item = _dis_get_localized(disease_id, lang)
    if not item:
        raise HTTPException(status_code=404, detail="Disease not found")
    return {**item, "image_url": disease_image(disease_id)}
