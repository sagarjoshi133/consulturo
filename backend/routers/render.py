"""ConsultUro — render router.

  · /api/render/pdf

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Response
from auth_deps import require_user
from models import RenderPdfBody

router = APIRouter()


@router.post("/api/render/pdf")
async def render_pdf(body: RenderPdfBody, user=Depends(require_user)):
    if not body.html or len(body.html) < 50:
        raise HTTPException(status_code=400, detail="HTML payload missing or too short")
    try:
        # Lazy import so the app can boot even if the wheel isn't installed
        # in dev — the route just 503s instead of crashing the server.
        from weasyprint import HTML  # type: ignore
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"PDF engine unavailable: {e}")

    # Run the (synchronous, CPU-bound) render in a worker thread so we
    # don't block the asyncio event loop. WeasyPrint itself is CPU-heavy
    # (~1-3 s for a typical Rx); offloading frees the loop to serve
    # other requests in parallel.
    import asyncio
    def _do_render() -> bytes:
        return HTML(string=body.html, base_url="https://www.drsagarjoshi.com/").write_pdf()
    try:
        pdf_bytes = await asyncio.to_thread(_do_render)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF render failed: {e}")

    fname = (body.filename or "prescription.pdf").strip().replace('"', '')
    if not fname.lower().endswith(".pdf"):
        fname += ".pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{fname}"',
            "Cache-Control": "no-store",
        },
    )
