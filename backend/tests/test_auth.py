"""Auth and tenant isolation tests.

The isolation test is the important one. Auth that lets any logged-in user
read any institution's ledger is not auth.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core import auth
from app.core.fiqh import FundCategory
from app.main import app, get_db
from app.models import AccountNature, Base, Fund, Institution, Role, User


@pytest.fixture()
def client(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/auth.db")
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine)

    def override():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override

    db = TestSession()
    for slug, email in (("masjid-a", "a@test.my"), ("masjid-b", "b@test.my")):
        inst = Institution(name=slug, slug=slug)
        db.add(inst)
        db.flush()
        db.add(
            Fund(
                institution_id=inst.id,
                code="cash",
                category=FundCategory.SADAQAH,
                label_ms="Tunai",
                label_en="Cash",
                nature=AccountNature.ASSET,
            )
        )
        db.add(
            Fund(
                institution_id=inst.id,
                code="sadaqah",
                category=FundCategory.SADAQAH,
                label_ms="Sedekah",
                label_en="Sadaqah",
            )
        )
        db.add(
            User(
                institution_id=inst.id,
                name=f"Treasurer {slug}",
                email=email,
                password_hash=auth.hash_password("correct-horse"),
                role=Role.TREASURER,
            )
        )
        db.add(
            User(
                institution_id=inst.id,
                name=f"Auditor {slug}",
                email=f"auditor-{email}",
                password_hash=auth.hash_password("correct-horse"),
                role=Role.AUDITOR,
            )
        )
    db.commit()
    db.close()

    yield TestClient(app)
    app.dependency_overrides.clear()


def token(client, email, password="correct-horse"):
    r = client.post("/auth/login", data={"username": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def head(t):
    return {"Authorization": f"Bearer {t}"}


def test_login_succeeds_with_correct_password(client):
    r = client.post(
        "/auth/login", data={"username": "a@test.my", "password": "correct-horse"}
    )
    assert r.status_code == 200
    assert r.json()["institution_slug"] == "masjid-a"


def test_login_fails_with_wrong_password(client):
    r = client.post(
        "/auth/login", data={"username": "a@test.my", "password": "wrong"}
    )
    assert r.status_code == 401


def test_unknown_email_and_wrong_password_look_identical(client):
    """The endpoint must not reveal which accounts exist."""
    a = client.post(
        "/auth/login", data={"username": "a@test.my", "password": "wrong"}
    )
    b = client.post(
        "/auth/login", data={"username": "nobody@test.my", "password": "wrong"}
    )
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_protected_routes_reject_anonymous(client):
    assert client.get("/i/masjid-a/funds").status_code == 401
    assert client.get("/i/masjid-a/verify").status_code == 401
    assert (
        client.post(
            "/i/masjid-a/donations",
            json={"fund_code": "sadaqah", "amount": 10, "description": "x"},
        ).status_code
        == 401
    )


def test_public_routes_stay_open(client):
    """Transparency is the product. These must not need a login."""
    assert client.get("/health").status_code == 200
    assert client.get("/rules").status_code == 200
    assert client.get("/public/masjid-a").status_code == 200


def test_user_cannot_read_another_institution(client):
    """The whole point of tenant isolation."""
    t = token(client, "a@test.my")
    assert client.get("/i/masjid-a/funds", headers=head(t)).status_code == 200

    r = client.get("/i/masjid-b/funds", headers=head(t))
    assert r.status_code == 404
    assert "masjid-b" in r.text


def test_user_cannot_write_to_another_institution(client):
    t = token(client, "a@test.my")
    r = client.post(
        "/i/masjid-b/donations",
        json={"fund_code": "sadaqah", "amount": 500, "description": "intrusion"},
        headers=head(t),
    )
    assert r.status_code == 404


def test_auditor_can_read_but_not_write(client):
    t = token(client, "auditor-a@test.my")
    assert client.get("/i/masjid-a/funds", headers=head(t)).status_code == 200
    assert client.get("/i/masjid-a/verify", headers=head(t)).status_code == 200

    r = client.post(
        "/i/masjid-a/donations",
        json={"fund_code": "sadaqah", "amount": 100, "description": "should fail"},
        headers=head(t),
    )
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "insufficient_role"


def test_treasurer_can_write(client):
    t = token(client, "a@test.my")
    r = client.post(
        "/i/masjid-a/donations",
        json={"fund_code": "sadaqah", "amount": 250, "description": "Tabung Jumaat"},
        headers=head(t),
    )
    assert r.status_code == 201
    assert r.json()["balance"] == "250.00"


def test_garbage_token_is_rejected(client):
    r = client.get("/i/masjid-a/funds", headers=head("not-a-real-token"))
    assert r.status_code == 401
