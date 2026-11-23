"""Setting up a real mosque."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import create_mosque
from app.models import Base, Device, Fund, Institution, User

DETAILS = dict(
    name="Masjid A",
    slug="masjid-a",
    state="Perak",
    admin_name="Admin",
    email=" Admin@A.my ",
    password="a-long-password",
    serial="BOX-101",
    box_label="Main door",
)


@pytest.fixture()
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/setup.db")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, autoflush=False)() as session:
        yield session


def test_creates_everything_and_a_box_that_can_collect(db):
    secret = create_mosque.create(db, **DETAILS)
    device = db.query(Device).one()
    assert device.shared_secret == secret and len(secret) == 48
    assert db.get(Fund, device.default_fund_id).code == "sadaqah"
    assert db.query(User).one().email == "admin@a.my"
    # nothing is made public until the mosque chooses to
    assert db.query(Institution).one().public_page_enabled is False


def test_second_mosque_keeps_the_first_and_duplicates_are_refused(db):
    create_mosque.create(db, **DETAILS)
    with pytest.raises(ValueError):
        create_mosque.create(db, **DETAILS)
    create_mosque.create(
        db, **{**DETAILS, "slug": "masjid-b", "email": "b@b.my", "serial": "BOX-102"}
    )
    assert db.query(Institution).count() == 2


def test_weak_password_is_refused_and_nothing_is_saved(db):
    with pytest.raises(ValueError):
        create_mosque.create(db, **{**DETAILS, "password": "demo1234"})
    assert db.query(Institution).count() == 0


def test_server_starts_after_seeding_twice(tmp_path):
    """The demo path: seed, start, seed again, start."""
    import os
    import subprocess
    import sys
    from pathlib import Path

    backend = Path(__file__).resolve().parents[1]
    env = dict(os.environ, AMANAH_DATABASE_URL=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
               AMANAH_PUSH="off", PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
    for key in [k for k in env if k.startswith("AMANAH_S3_") or k in ("AMANAH_ENV", "RENDER")]:
        del env[key]
    start = (
        "from fastapi.testclient import TestClient; from app.main import app\n"
        "with TestClient(app) as c: assert c.get('/health').status_code == 200"
    )
    for args in (["seed.py"], ["-c", start], ["seed.py"], ["-c", start]):
        done = subprocess.run([sys.executable, *args], cwd=backend, env=env,
                              capture_output=True, text=True, encoding="utf-8")
        assert done.returncode == 0, done.stderr[-2000:]
