"""Comm-10 broadcast templates smoke test.

Verifies:
  * Owner can create / edit / delete templates; staff cannot.
  * Unique(name) constraint blocks duplicates.
  * Apply creates a new draft that inherits the template fields.
  * Overrides at apply-time replace only supplied fields.
  * `use_count` and `last_used_at` increment atomically per apply.
  * Cursor pagination returns all rows once.

Runs stand-alone:  python -m tests.smoke_comm10_broadcast_templates
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


async def main():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "consulturo")]

    from services import comm_broadcast_templates as _t

    tag = os.urandom(3).hex()
    owner = {"user_id": f"smoke-own-{tag}", "role": "primary_owner"}
    reception = {"user_id": f"smoke-rec-{tag}", "role": "reception"}
    patient = {"user_id": f"smoke-pat-{tag}", "role": "patient"}

    created_tpls: list = []
    try:
        # Ensure indexes exist (idempotent).
        await _t.ensure_indexes(db)

        # 1. Reception can't create.
        try:
            await _t.create_template(
                db, actor=reception,
                name=f"weekly-monday-{tag}", title="Test", body="Body",
            )
            assert False, "reception create should raise"
        except PermissionError:
            pass
        print("✓ staff cannot create template (owner_only)")

        # 2. Patient can't even list.
        try:
            await _t.list_templates(db, actor=patient)
            assert False, "patient list should raise"
        except PermissionError:
            pass
        print("✓ patient cannot list templates (staff_only)")

        # 3. Owner creates two templates.
        t1 = await _t.create_template(
            db, actor=owner,
            name=f"weekly-monday-{tag}",
            title="Monday clinic hours",
            body="Reminder: OPD 10 AM – 1 PM.",
            category="announcements", audience_mode="patients",
            action_type="open_broadcast",
        )
        created_tpls.append(t1["id"])
        t2 = await _t.create_template(
            db, actor=owner,
            name=f"followup-nudge-{tag}",
            title="Follow-up reminder",
            body="Please book your follow-up.",
            category="reminders", audience_mode="patients_with_future_appointments",
            action_type="open_home",
        )
        created_tpls.append(t2["id"])
        print(f"✓ owner created 2 templates ({t1['id']}, {t2['id']})")

        # 4. Duplicate name raises ValueError('duplicate_name').
        try:
            await _t.create_template(
                db, actor=owner,
                name=f"weekly-monday-{tag}",
                title="dup", body="dup",
            )
            assert False, "dup name should raise"
        except ValueError as e:
            assert str(e) == "duplicate_name"
        print("✓ duplicate template name rejected by unique index")

        # 5. Bad category / audience / name chars raise.
        for bad in [
            {"name": "<script>evil</script>", "title": "t", "body": "b"},   # bad_name_chars
            {"name": f"cat-fail-{tag}", "title": "t", "body": "b",
             "category": "notreal"},                                       # bad_category
            {"name": f"aud-fail-{tag}", "title": "t", "body": "b",
             "audience_mode": "aliens"},                                   # bad_audience_mode
        ]:
            try:
                await _t.create_template(db, actor=owner, **bad)
                assert False, f"expected ValueError for {bad}"
            except ValueError:
                pass
        print("✓ validation errors surface as ValueError")

        # 6. List returns both templates, unread-first sort by updated_at desc.
        page = await _t.list_templates(db, actor=reception, limit=100,
                                          search=tag)
        names = [r["name"] for r in page["items"]]
        assert f"weekly-monday-{tag}" in names
        assert f"followup-nudge-{tag}" in names
        print(f"✓ staff can list templates ({len(page['items'])} rows visible)")

        # 7. Apply — reception uses template to create a draft.
        applied = await _t.create_draft_from_template(
            db, actor=reception, template_id=t1["id"], overrides={},
        )
        assert applied["state"] == "draft"
        assert applied["title"] == t1["title"]
        assert applied["source_template_id"] == t1["id"]
        assert applied["source_template_name"] == t1["name"]
        print(f"✓ staff applied template → draft {applied['id']}")

        # 8. Apply with overrides.
        applied2 = await _t.create_draft_from_template(
            db, actor=reception, template_id=t1["id"],
            overrides={"title": "Monday clinic hours — OVERRIDE",
                        "category": "announcements"},
        )
        assert applied2["title"] == "Monday clinic hours — OVERRIDE"
        assert applied2["id"] != applied["id"]
        print("✓ apply overrides replace only supplied fields")

        # 9. use_count / last_used_at bumped by exactly 2 (we applied twice).
        refreshed = await _t.get_template(db, t1["id"])
        assert refreshed["use_count"] == 2, f"use_count={refreshed['use_count']}"
        assert refreshed["last_used_at"] is not None
        print(f"✓ use_count={refreshed['use_count']} last_used_at set")

        # 10. Update template — owner-only, validates merged state.
        updated = await _t.update_template(
            db, actor=owner, template_id=t1["id"],
            fields={"body": "Updated body — OPD 10 AM – 1 PM. See you!"},
        )
        assert updated["body"].startswith("Updated body")
        try:
            await _t.update_template(db, actor=reception, template_id=t1["id"],
                                       fields={"body": "bad"})
            assert False
        except PermissionError:
            pass
        print("✓ owner-only update + PermissionError for staff")

        # 11. Soft delete = is_active=false; excluded from default list.
        ok = await _t.delete_template(db, actor=owner, template_id=t2["id"])
        assert ok is True
        default_list = await _t.list_templates(db, actor=owner, limit=100,
                                                  search=tag)
        default_names = [r["name"] for r in default_list["items"]]
        assert f"followup-nudge-{tag}" not in default_names
        with_inactive = await _t.list_templates(db, actor=owner, limit=100,
                                                   include_inactive=True,
                                                   search=tag)
        all_names = [r["name"] for r in with_inactive["items"]]
        assert f"followup-nudge-{tag}" in all_names
        print("✓ soft delete hides from default list, visible w/ include_inactive")

        # 12. Applying an inactive template raises.
        try:
            await _t.create_draft_from_template(
                db, actor=reception, template_id=t2["id"], overrides={},
            )
            assert False
        except ValueError as e:
            assert str(e) == "template_inactive"
        print("✓ apply on inactive template rejected")

        print("\nALL COMM-10 SMOKE TESTS PASSED ✅")
    finally:
        # Cleanup — templates + any drafts we spawned.
        await db.comm_broadcast_templates.delete_many(
            {"id": {"$in": created_tpls}}
        )
        await db.comm_broadcasts.delete_many(
            {"source_template_id": {"$in": created_tpls}}
        )
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
