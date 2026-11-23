"""alerts, live events, push, replay protection, cloud evidence

Older releases created some of these tables directly, so each step first checks
whether it is already there.

Revision ID: 7c1e52b0a9d4
Revises: 13fa679c302e
"""

import sqlalchemy as sa
from alembic import op

revision = "7c1e52b0a9d4"
down_revision = "13fa679c302e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    tables = set(insp.get_table_names())

    have = {c["name"] for c in insp.get_columns("devices")}
    for column in (
        sa.Column("door_state", sa.String(10), nullable=True),
        sa.Column("door_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("door_alerted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("offline_alerted", sa.Boolean(), nullable=False, server_default=sa.false()),
    ):
        if column.name not in have:
            op.add_column("devices", column)

    if "push_tokens" not in tables:
        op.create_table(
            "push_tokens",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("institution_id", sa.String(36), sa.ForeignKey("institutions.id"), nullable=False),
            sa.Column("token", sa.String(200), nullable=False, unique=True),
            sa.Column("platform", sa.String(20), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )

    if "alerts" not in tables:
        op.create_table(
            "alerts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("institution_id", sa.String(36), sa.ForeignKey("institutions.id"), nullable=False),
            sa.Column("seq", sa.Integer(), nullable=False),
            sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id"), nullable=True),
            sa.Column(
                "kind",
                sa.Enum(
                    "UNEXPLAINED_WEIGHT", "TRAY_EMPTIED", "COUNT_VARIANCE",
                    "TAMPER_SUSPECTED", "CHAIN_BROKEN", "DOOR_OPENED",
                    "DOOR_LEFT_OPEN", "VIBRATION", "DEVICE_OFFLINE",
                    name="alertkind",
                ),
                nullable=False,
            ),
            sa.Column("severity", sa.Enum("INFO", "WARNING", "CRITICAL", name="alertseverity"), nullable=False),
            sa.Column("status", sa.Enum("OPEN", "ACKNOWLEDGED", "ESCALATED", name="alertstatus"), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("detail", sa.Text(), nullable=False),
            sa.Column("related_reference", sa.String(40), nullable=True),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("photo", sa.LargeBinary(), nullable=True),
            sa.Column("photo_key", sa.String(200), nullable=True),
            sa.Column("photo_mime", sa.String(40), nullable=True),
            sa.Column("photo_sha256", sa.String(64), nullable=True),
            sa.Column("device_signature", sa.String(64), nullable=True),
            sa.Column("payload_hash", sa.String(64), nullable=False),
            sa.Column("prev_hash", sa.String(64), nullable=False),
            sa.Column("chain_hash", sa.String(64), nullable=False),
            sa.Column("reviewed_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("review_note", sa.Text(), nullable=True),
            sa.UniqueConstraint("institution_id", "seq"),
        )
        op.create_index("ix_alert_institution_status", "alerts", ["institution_id", "status"])
    else:
        have = {c["name"] for c in insp.get_columns("alerts")}
        if "photo_key" not in have:
            op.add_column("alerts", sa.Column("photo_key", sa.String(200), nullable=True))
        if op.get_bind().dialect.name == "postgresql":
            for kind in ("DOOR_OPENED", "DOOR_LEFT_OPEN", "VIBRATION", "DEVICE_OFFLINE"):
                op.execute(f"ALTER TYPE alertkind ADD VALUE IF NOT EXISTS '{kind}'")

    if "device_events" not in tables:
        op.create_table(
            "device_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("institution_id", sa.String(36), sa.ForeignKey("institutions.id"), nullable=False),
            sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id"), nullable=True),
            sa.Column("kind", sa.String(30), nullable=False),
            sa.Column("detail", sa.Text(), nullable=False),
            sa.Column("alert_id", sa.String(36), sa.ForeignKey("alerts.id"), nullable=True),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_device_event_inst_time", "device_events", ["institution_id", "created_at"])

    if "device_messages" not in tables:
        op.create_table(
            "device_messages",
            sa.Column("device_id", sa.String(36), sa.ForeignKey("devices.id"), primary_key=True),
            sa.Column("event_id", sa.String(64), primary_key=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_device_message_expires", "device_messages", ["expires_at"])


def downgrade() -> None:
    raise NotImplementedError("Going back would delete evidence. Restore a backup.")
