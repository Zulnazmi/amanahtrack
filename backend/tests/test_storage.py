"""Evidence photos in private cloud storage, against a local S3 server."""

import hashlib

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from test_alerts import PNG, env, login, post_alert  # noqa: F401

import app.main as main
from app.core import config, migrate
from app.models import Alert, Base, Institution, User
from app.services import storage

moto_server = pytest.importorskip("moto.server")


@pytest.fixture(scope="module")
def server():
    s = moto_server.ThreadedMotoServer(port=0)
    s.start()
    host, port = s.get_host_and_port()
    yield f"http://127.0.0.1:{port}"
    s.stop()


@pytest.fixture()
def store(server, monkeypatch):
    monkeypatch.setenv("AMANAH_S3_REGION", "us-east-1")
    st = storage.S3Store(server, "evidence", "id", "secret")
    st.client.create_bucket(Bucket="evidence")
    monkeypatch.setattr(main, "photo_store", st)
    yield st
    for o in st.client.list_objects_v2(Bucket="evidence").get("Contents", []):
        st.client.delete_object(Bucket="evidence", Key=o["Key"])
    st.client.delete_bucket(Bucket="evidence")


def only(Session):
    with Session() as db:
        a = db.query(Alert).one()
        return a.id, a.photo, a.photo_key, a.institution_id


def verify(c, aid):
    return c.post(f"/i/masjid-a/alerts/{aid}/verify", headers=login(c, "c@a.my"))


def test_photo_moves_to_the_cloud_and_still_verifies(env, store):  # noqa: F811
    c, Session, _ = env
    post_alert(c)
    assert storage.archive_pending(Session, store) == 1
    assert storage.archive_pending(Session, store) == 0
    aid, photo, key, inst = only(Session)
    assert photo is None
    assert key == f"{inst}/{hashlib.sha256(PNG).hexdigest()}.png"

    h = login(c, "c@a.my")
    assert c.get("/i/masjid-a/alerts", headers=h).json()[0]["has_photo"] is True
    got = c.get(f"/i/masjid-a/alerts/{aid}/photo", headers=h)
    assert got.content == PNG and got.headers["content-type"] == "image/png"
    assert verify(c, aid).json()["intact"] is True
    # the cloud changes nothing about who may look
    assert c.get(f"/i/masjid-a/alerts/{aid}/photo").status_code == 401
    other = login(c, "o@b.my")
    assert c.get(f"/i/masjid-b/alerts/{aid}/photo", headers=other).status_code == 404


def test_swapped_cloud_photo_is_caught(env, store):  # noqa: F811
    c, Session, _ = env
    post_alert(c)
    storage.archive_pending(Session, store)
    aid, _, key, _ = only(Session)
    store.put(key, PNG + b"x", "image/png")
    assert verify(c, aid).json()["intact"] is False


def test_deleted_cloud_photo_is_caught(env, store):  # noqa: F811
    c, Session, _ = env
    post_alert(c)
    storage.archive_pending(Session, store)
    aid, _, key, _ = only(Session)
    store.client.delete_object(Bucket="evidence", Key=key)
    assert verify(c, aid).json()["intact"] is False
    h = login(c, "c@a.my")
    assert c.get(f"/i/masjid-a/alerts/{aid}/photo", headers=h).status_code == 410


def test_photo_wiped_from_the_database_is_caught(env):  # noqa: F811
    c, Session, _ = env
    post_alert(c)
    with Session() as db:
        db.query(Alert).one().photo = None
        db.commit()
    assert verify(c, only(Session)[0]).json()["intact"] is False


def test_outage_is_not_called_tampering_and_loses_nothing(env, store, monkeypatch):  # noqa: F811
    c, Session, _ = env
    down = storage.S3Store("http://127.0.0.1:9", "evidence", "id", "secret")
    assert post_alert(c).status_code == 201
    with pytest.raises(storage.StorageUnavailable):
        storage.archive_pending(Session, down)
    assert only(Session)[1] == PNG

    storage.archive_pending(Session, store)
    aid = only(Session)[0]
    monkeypatch.setattr(main, "photo_store", down)
    h = login(c, "c@a.my")
    assert verify(c, aid).status_code == 503
    assert c.get(f"/i/masjid-a/alerts/{aid}/photo", headers=h).status_code == 503


def test_bad_upload_keeps_the_original(env):  # noqa: F811
    c, Session, _ = env
    post_alert(c)

    class Corrupting:
        def put(self, *a): ...
        def get(self, key): return b"garbage"

    with pytest.raises(storage.StorageUnavailable):
        storage.archive_pending(Session, Corrupting())
    assert only(Session)[1] == PNG and only(Session)[2] is None


def test_an_altered_photo_is_never_moved(env, store):  # noqa: F811
    c, Session, _ = env
    post_alert(c)
    with Session() as db:
        db.query(Alert).one().photo = PNG + b"x"
        db.commit()
    assert storage.archive_pending(Session, store) == 0
    assert verify(c, only(Session)[0]).json()["intact"] is False


def test_half_a_setup_is_refused(monkeypatch):
    for name in storage.SETTINGS:
        monkeypatch.delenv(name, raising=False)
    assert storage.from_env() is None
    monkeypatch.setenv("AMANAH_S3_BUCKET", "evidence")
    with pytest.raises(RuntimeError):
        storage.from_env()


# ------------------------------------------------------------- migrations


def schema_diff(engine):
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    with engine.connect() as conn:
        return compare_metadata(MigrationContext.configure(conn), Base.metadata)


def test_a_new_database_matches_the_models(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/new.db")
    migrate.upgrade(engine)
    migrate.upgrade(engine)
    assert schema_diff(engine) == []


def test_an_older_database_is_upgraded_and_keeps_its_data(tmp_path):
    """What an earlier release left behind: tables, but no version."""
    engine = create_engine(f"sqlite:///{tmp_path}/old.db")
    migrate.upgrade(engine, "7c1e52b0a9d4")
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE alembic_version"))
        conn.execute(text("DROP TABLE device_messages"))
        conn.execute(text("ALTER TABLE alerts DROP COLUMN photo_key"))
        conn.execute(text("ALTER TABLE devices DROP COLUMN door_alerted"))
        conn.execute(text(
            "INSERT INTO institutions (id, name, slug, public_page_enabled, created_at)"
            " VALUES ('i', 'Keep me', 'keep', 1, '2026-01-01 00:00:00')"
        ))
        conn.execute(text(
            "INSERT INTO users (id, institution_id, name, email, role, active, created_at)"
            " VALUES ('u', 'i', 'Old user', 'Old@a.my', 'ADMIN', 1, '2026-01-01 00:00:00')"
        ))
    migrate.upgrade(engine)
    assert "photo_key" in {c["name"] for c in inspect(engine).get_columns("alerts")}
    assert schema_diff(engine) == []
    with sessionmaker(bind=engine)() as db:
        inst = db.query(Institution).one()
        assert inst.name == "Keep me" and inst.approval_limit is None
        user = db.query(User).one()
        assert user.token_version == 0 and user.must_change_password is False


def test_hosted_database_links_use_the_right_driver(monkeypatch):
    for given in ("postgres://u:p@h/d", "postgresql://u:p@h/d"):
        monkeypatch.setenv("AMANAH_DATABASE_URL", given)
        assert config.database_url() == "postgresql+psycopg://u:p@h/d"
