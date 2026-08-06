"""ConsultUro — Blog content helpers.

  • _extract_first_img / _strip_html — quick HTML utilities.
  • _load_blog_from_blogger          — fetches the legacy Blogger
                                       feed (when the user-managed
                                       blog has no native posts).
  • _admin_to_html                   — converts the admin Markdown
                                       editor's payload to safe
                                       HTML for public rendering.
  • _apply_custom_cover              — overlays a user-set cover
                                       URL onto blog post objects.
"""
import os
import re
import json
import uuid
import logging
import html as htmllib
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx

from db import db

log = logging.getLogger(__name__)

# Blogger feed URL (legacy ConsultUro blog before native posts)
BLOGGER_FEED_URL = os.environ.get(
    "BLOGGER_FEED_URL",
    "https://consulturo.blogspot.com/feeds/posts/default?alt=json",
)

_BLOG_CACHE: Dict[str, Any] = {"at": None, "data": []}

# Compiled regexes used by the public helpers below — defined once
# at module scope so the helpers stay allocation-free on the
# hot path.
_IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"', re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")

# Static cover overrides for the in-app patient-education library.
# Sourced from the customer-assets agent — these win over the auto-
# generated covers from the trilingual education_content module.
_EDU_CUSTOM_COVERS: Dict[str, str] = {
    "kegel-exercises": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/l8lew19k_kegel-exercises.png",
    "bladder-training": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/ldp1ptw5_bladder-training.png",
    "fluid-management": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/jp8oigj5_fluid-management.png",
    "pre-op-prep": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/20rjyu3l_pre-op-prep.png",
    "psa-testing": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/236tiy5s_psa-testing.png",
    "stone-prevention": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/owc6yhgd_stone-prevention.png",
    "uti-prevention": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/spbpzrg2_uti-prevention.png",
    "post-surgery-care": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/oosn7esm_post-surgery-care.png",
    "bph-lifestyle": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/a1theb2u_bph-lifestyle.png",
    "ed-overview": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/gji6t5ah_ed-overview.png",
    "catheter-care": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/v8h8jvl6_catheter-care.png",
    "dj-stent-care": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/cv2jr3re_dj-stent-care.png",
    "travel-kidney-stones": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/3ujztgy6_travel-kidney-stones.png",
    "vasectomy-guide": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/bmbsnu7x_vasectomy-guide.png",
    "circumcision-care": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/ag2i8ofo_circumcision-care.png",
    "pregnancy-urology": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/32bc4962_pregnancy-urology.png",
    "kidney-donor": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/h9uehlhe_kidney-donor.png",
    "telehealth-tips": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/yb5q5peq_telehealth-tips.png",
    "sexual-health-general": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/o3mji7p1_sexual-health-general.png",
    "prostate-cancer-screening": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/7eb0gtrq_prostate-cancer-screening.png",
    "bladder-cancer-haematuria": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/n0c9r1u1_bladder-cancer-haematuria.png",
    "kidney-cancer": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/vg21g7mo_kidney-cancer.png",
    "testicular-self-exam": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/3ds1nlgo_testicular-self-exam.png",
    "overactive-bladder": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/o7hd6yem_overactive-bladder.png",
    "nocturia": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/ifbhb30q_nocturia.png",
    "varicocele": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/ajluw3u8_varicocele.png",
    "male-infertility": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/uz8aytiq_male-infertility.png",
    "low-testosterone": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/7b4gmpxb_low-testosterone.png",
    "peyronies-disease": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/zn56l8pq_peyronies-disease.png",
    "prostatitis": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/rid3zc0e_prostatitis.png",
    "urethral-stricture": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/nuo4kjh7_urethral-stricture.png",
    "eswl-shockwave": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/5xmv39uz_eswl-shockwave.png",
    "rirs-flexible-ureteroscopy": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/1onj0b8c_rirs-flexible-ureteroscopy.png",
    "turp-holep-bph": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/md7v1jy2_turp-holep-bph.png",
    "paediatric-bedwetting": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/xndfw7qn_paediatric-bedwetting.png",
    "diet-for-urology": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/a73yftb4_diet-for-urology.png",
    "exercise-urology": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/f52bncsd_exercise-urology.png",
}


def _extract_first_img(html: str) -> Optional[str]:
    m = _IMG_RE.search(html or "")
    if not m:
        return None
    url = m.group(1).replace(r"\/", "/")
    url = re.sub(r"/s\d+(-[wh]\d+(-[ch])?)?/", "/s800/", url)
    url = re.sub(r"/w\d+-h\d+(-c)?/", "/s800/", url)
    return url

def _strip_html(html: str) -> str:
    # Remove script/style blocks first (their content is junk for excerpts)
    cleaned = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html or "", flags=re.IGNORECASE)
    # Remove HTML comments
    cleaned = re.sub(r"<!--([\s\S]*?)-->", " ", cleaned)
    txt = _TAG_RE.sub(" ", cleaned)
    txt = htmllib.unescape(txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt

async def _load_blog_from_blogger() -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    if _BLOG_CACHE["at"] and (now - _BLOG_CACHE["at"]).total_seconds() < 900:
        return _BLOG_CACHE["data"]
    try:
        async with httpx.AsyncClient(timeout=10.0) as hc:
            r = await hc.get(BLOGGER_FEED_URL)
            r.raise_for_status()
            feed = r.json().get("feed", {})
            posts = []
            for e in feed.get("entry", []):
                raw = e.get("content", {}).get("$t", "") or ""
                cats = [c.get("term") for c in e.get("category", []) if c.get("term")]
                alt_link = next(
                    (lk.get("href") for lk in e.get("link", []) if lk.get("rel") == "alternate"),
                    None,
                )
                post_id = (e.get("id", {}).get("$t") or "").split(".post-")[-1] or uuid.uuid4().hex
                cover = _extract_first_img(raw) or (e.get("media$thumbnail", {}) or {}).get("url") or ""
                posts.append(
                    {
                        "id": post_id,
                        "title": e.get("title", {}).get("$t", "Untitled"),
                        "category": cats[0] if cats else "Urology",
                        "categories": cats,
                        "cover": cover,
                        "excerpt": _strip_html(raw)[:240] + ("…" if len(raw) > 240 else ""),
                        "content_html": raw,
                        "published_at": (e.get("published", {}).get("$t") or "")[:10],
                        "link": alt_link,
                    }
                )
            _BLOG_CACHE["at"] = now
            _BLOG_CACHE["data"] = posts
            return posts
    except Exception:
        return _BLOG_CACHE["data"] or []

def _admin_to_html(text: str) -> str:
    """Convert the composer's plain-text body into light HTML
    (paragraphs + preserve existing tags the user may have typed)."""
    if not text:
        return ""
    if "<p>" in text or "<img" in text or "<h" in text:
        return text
    paras = [p.strip() for p in re.split(r"\n\s*\n+", text) if p.strip()]
    return "".join(f"<p>{htmllib.escape(p).replace(chr(10), '<br/>')}</p>" for p in paras)

def _apply_custom_cover(item: Dict[str, Any]) -> Dict[str, Any]:
    if not item:
        return item
    override = _EDU_CUSTOM_COVERS.get(item.get("id", ""))
    if override:
        item = {**item, "cover": override}
    return item
