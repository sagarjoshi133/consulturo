"""Comm-3 API smoke — proves the full Notification Centre flow.

Uses a synthetic user + direct service calls (no HTTP) so we don't
need a real session token.
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


async def main():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "consulturo")]
    from services import comm_inbox

    smoke_uid = "smoke-user-" + os.urandom(4).hex()

    # 1. Create 10 items across categories
    print("--- Create phase ---")
    ids = []
    for i in range(10):
        cat = ["appointments", "care_updates", "reminders", "announcements",
               "system", "security", "marketing"][i % 7]
        item = await comm_inbox.create_inbox_item(
            db, user_id=smoke_uid, category=cat,
            title=f"Item {i}", body=f"Body {i}",
            item_type=f"smoke:v{i}", source_id=f"smoke-{smoke_uid}-{i}",
            action_type="open_home",
        )
        ids.append(item["id"])
    print(f"  created 10 items")

    # 2. Idempotent create — repeating same (user, item_type, source_id)
    #    should return the existing row, not raise.
    dup = await comm_inbox.create_inbox_item(
        db, user_id=smoke_uid, category="appointments",
        title="Dup title", body="Dup body",
        item_type="smoke:v0", source_id=f"smoke-{smoke_uid}-0",
        action_type="open_home",
    )
    assert dup["id"] == ids[0], f"dedupe failed: {dup['id']} != {ids[0]}"
    print("✓ (user, item_type, source_id) dedupe returns existing id")

    # 3. Invalid category → coerced to system
    bad = await comm_inbox.create_inbox_item(
        db, user_id=smoke_uid, category="totally-fake",
        title="Bad cat", body="",
        item_type="smoke:badcat", source_id=f"smoke-{smoke_uid}-badcat",
    )
    assert bad["category"] == "system"
    print("✓ invalid category coerced to 'system'")

    # 4. Invalid action_type → coerced to none
    bad2 = await comm_inbox.create_inbox_item(
        db, user_id=smoke_uid, category="system",
        title="Bad action", body="",
        item_type="smoke:badact", source_id=f"smoke-{smoke_uid}-badact",
        action_type="run_arbitrary_javascript",  # must be rejected
    )
    assert bad2["action_type"] == "none"
    print("✓ invalid action_type coerced to 'none'")

    # 5. Cursor pagination — page through 6 items 3 at a time
    print("\n--- List / pagination ---")
    got_all = []
    cursor = None
    while True:
        page = await comm_inbox.list_inbox(db, user_id=smoke_uid, limit=3, cursor=cursor)
        got_all.extend([r["id"] for r in page["items"]])
        cursor = page["next_cursor"]
        if not cursor:
            break
    # We created 12 items (10 + bad + bad2)
    assert len(got_all) == 12, f"paginated total {len(got_all)} != 12"
    assert len(set(got_all)) == 12, "duplicate id in pagination!"
    print(f"✓ cursor pagination returned all {len(got_all)} items with no duplicates")

    # 6. Counts BEFORE any read
    counts_before = await comm_inbox.counts(db, user_id=smoke_uid)
    assert counts_before["total_unread"] == 12
    print(f"✓ pre-read counts: total={counts_before['total_unread']}, by_cat={counts_before['by_category']}")

    # 7. mark_read affects ONLY supplied ids
    n = await comm_inbox.mark_read(db, user_id=smoke_uid, item_ids=ids[:3])
    assert n == 3
    counts_after = await comm_inbox.counts(db, user_id=smoke_uid)
    assert counts_after["total_unread"] == 9
    print(f"✓ marked first 3 read → total_unread {counts_after['total_unread']} (expected 9)")

    # 8. mark_read with only-read ids → no-op (return 0)
    n2 = await comm_inbox.mark_read(db, user_id=smoke_uid, item_ids=ids[:3])
    assert n2 == 0
    print("✓ re-marking already-read is a no-op")

    # 9. Cross-user isolation — a DIFFERENT user should see nothing
    other = await comm_inbox.list_inbox(db, user_id="other-user-xyz", limit=100)
    assert other["count"] == 0
    print("✓ cross-user inbox isolation")

    # 10. Archive removes from default list, but keeps for include_archived
    ok = await comm_inbox.archive(db, user_id=smoke_uid, item_id=ids[5])
    assert ok
    default_list = await comm_inbox.list_inbox(db, user_id=smoke_uid, limit=100)
    with_arch = await comm_inbox.list_inbox(db, user_id=smoke_uid, limit=100, include_archived=True)
    assert len(default_list["items"]) == 11
    assert len(with_arch["items"]) == 12
    print(f"✓ archive: default={len(default_list['items'])} include_archived={len(with_arch['items'])}")

    # 11. Cleanup
    await db.comm_inbox_items.delete_many({"user_id": smoke_uid})
    print("\nALL COMM-3 SMOKE TESTS PASSED ✅")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
