"""approvals, receipts, named witnesses, user management

Revision ID: a41d90c3e7b2
Revises: 7c1e52b0a9d4
"""

import sqlalchemy as sa
from alembic import op

revision = "a41d90c3e7b2"
down_revision = "7c1e52b0a9d4"
branch_labels = None
depends_on = None


def _fk(name, target, nullable=False):
    return sa.Column(name, sa.String(36), sa.ForeignKey(f"{target}.id"), nullable=nullable)


def upgrade() -> None:
    op.add_column("institutions", sa.Column("approval_limit", sa.Numeric(14, 2), nullable=True))
    op.add_column("users", sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("transactions", sa.Column("request_id", sa.String(64), nullable=True))
    op.create_index("ux_txn_request", "transactions", ["institution_id", "request_id"], unique=True)
    op.add_column("count_sessions", sa.Column("witness_names", sa.Text(), nullable=True))

    op.create_table(
        "approvals",
        sa.Column("id", sa.String(36), primary_key=True),
        _fk("institution_id", "institutions"),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("request_id", sa.String(64), nullable=True),
        _fk("fund_id", "funds", True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("purpose", sa.String(40), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        _fk("target_id", "transactions", True),
        _fk("requested_by", "users"),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        _fk("decided_by", "users", True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        _fk("result_id", "transactions", True),
    )
    op.create_index("ix_approval_status", "approvals", ["institution_id", "status"])
    op.create_index("ux_approval_request", "approvals", ["institution_id", "request_id"], unique=True)

    op.create_table(
        "receipts",
        sa.Column("id", sa.String(36), primary_key=True),
        _fk("institution_id", "institutions"),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("transaction_id", sa.String(36), sa.ForeignKey("transactions.id"), nullable=False, unique=True),
        sa.Column("donor_name", sa.String(120), nullable=True),
        _fk("issued_by", "users"),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("institution_id", "seq"),
    )

    op.create_table(
        "audit_log",
        sa.Column("id", sa.String(36), primary_key=True),
        _fk("institution_id", "institutions"),
        _fk("actor_id", "users"),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_inst_time", "audit_log", ["institution_id", "created_at"])


def downgrade() -> None:
    raise NotImplementedError("Going back would delete records. Restore a backup.")
