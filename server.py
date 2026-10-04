import json
import mimetypes
import random
import re
import sqlite3
from contextlib import contextmanager
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import ai_engine


ROOT = Path(__file__).parent.resolve()
DB_PATH = ROOT / "data" / "airpower.db"


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize():
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS aircraft (
                id TEXT PRIMARY KEY,
                model TEXT NOT NULL,
                squadron TEXT NOT NULL,
                base TEXT NOT NULL,
                status TEXT NOT NULL,
                flight_hours REAL NOT NULL,
                last_service TEXT NOT NULL,
                health INTEGER NOT NULL,
                next_inspection TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                aircraft_id TEXT NOT NULL REFERENCES aircraft(id),
                component TEXT NOT NULL,
                severity TEXT NOT NULL,
                created_at TEXT NOT NULL,
                acknowledged INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS telemetry_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                aircraft_id TEXT NOT NULL REFERENCES aircraft(id),
                component TEXT NOT NULL,
                sample_cycle INTEGER NOT NULL,
                observed_at TEXT NOT NULL,
                vibration_rms REAL NOT NULL,
                thermal_deviation REAL NOT NULL,
                pressure_drift REAL NOT NULL,
                response_lag REAL NOT NULL,
                UNIQUE (aircraft_id, component, sample_cycle)
            );
            CREATE TABLE IF NOT EXISTS work_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                aircraft_id TEXT NOT NULL REFERENCES aircraft(id),
                title TEXT NOT NULL,
                priority TEXT NOT NULL,
                status TEXT NOT NULL,
                due_date TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS inventory (
                id TEXT PRIMARY KEY,
                part TEXT NOT NULL,
                part_number TEXT NOT NULL,
                category TEXT NOT NULL,
                on_hand INTEGER NOT NULL,
                reorder_point INTEGER NOT NULL,
                lead_days INTEGER NOT NULL,
                location TEXT NOT NULL
            );
            """
        )
        today = date.today()
        if db.execute("SELECT COUNT(*) FROM aircraft").fetchone()[0]:
            existing_alerts = rows(
                db,
                    """SELECT aircraft_id, component, severity FROM alerts""",
            )
            seed_telemetry(db, existing_alerts, today)
            return

        aircraft = [
            ("AC-104", "Multi-role", "No. 7 Squadron", "North Sector", "Available", 1284, -18, 96, 11),
            ("AC-117", "Multi-role", "No. 7 Squadron", "North Sector", "Available", 986, -32, 91, 24),
            ("AC-203", "Air superiority", "No. 14 Squadron", "Western Sector", "Inspection", 1542, -4, 78, 3),
            ("AC-211", "Air superiority", "No. 14 Squadron", "Western Sector", "Available", 1108, -21, 94, 16),
            ("AC-308", "Multi-role", "No. 22 Squadron", "Central Sector", "Grounded", 1730, -47, 42, 0),
            ("AC-316", "Multi-role", "No. 22 Squadron", "Central Sector", "Available", 762, -13, 98, 31),
            ("AC-402", "Interceptor", "No. 31 Squadron", "Eastern Sector", "Available", 1396, -27, 89, 8),
            ("AC-419", "Interceptor", "No. 31 Squadron", "Eastern Sector", "Inspection", 920, -2, 73, 2),
            ("AC-507", "Trainer", "No. 5 Squadron", "Southern Sector", "Available", 640, -15, 97, 28),
            ("AC-522", "Trainer", "No. 5 Squadron", "Southern Sector", "Available", 588, -19, 93, 35),
            ("AC-611", "Multi-role", "No. 18 Squadron", "Western Sector", "Available", 1204, -24, 88, 14),
            ("AC-625", "Multi-role", "No. 18 Squadron", "Western Sector", "Available", 842, -11, 95, 22),
        ]
        db.executemany(
            """INSERT INTO aircraft VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (id_, model, squadron, base, status, hours, (today + timedelta(days=serviced)).isoformat(),
                 health, (today + timedelta(days=inspection)).isoformat())
                for id_, model, squadron, base, status, hours, serviced, health, inspection in aircraft
            ],
        )
        alerts = [
            ("AC-308", "Hydraulic pump", "Critical", -1, 0),
            ("AC-203", "Landing gear actuator", "High", -2, 0),
            ("AC-402", "Engine bearing", "High", -3, 0),
            ("AC-117", "Fuel control unit", "Medium", -4, 0),
            ("AC-419", "Avionics cooling fan", "Medium", -5, 0),
            ("AC-211", "Brake assembly", "Low", -7, 0),
            ("AC-104", "Oil filter", "Low", -8, 1),
        ]
        db.executemany(
            """INSERT INTO alerts
               (aircraft_id, component, severity, created_at, acknowledged)
               VALUES (?, ?, ?, ?, ?)""",
            [
                (aircraft_id, component, severity, (today + timedelta(days=created)).isoformat(), acknowledged)
                for aircraft_id, component, severity, created, acknowledged in alerts
            ],
        )
        seed_telemetry(db, alerts, today)
        db.executemany(
            """INSERT INTO work_orders (aircraft_id, title, priority, status, due_date, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [
                ("AC-308", "Hydraulic pump inspection", "Urgent", "In progress", (today + timedelta(days=1)).isoformat(), today.isoformat()),
                ("AC-203", "Landing gear actuator assessment", "High", "Scheduled", (today + timedelta(days=2)).isoformat(), today.isoformat()),
                ("AC-419", "Cooling system inspection", "Routine", "Scheduled", (today + timedelta(days=3)).isoformat(), today.isoformat()),
                ("AC-104", "Flight control linkage check", "Routine", "Completed", (today - timedelta(days=1)).isoformat(), (today - timedelta(days=4)).isoformat()),
            ],
        )
        db.executemany(
            """INSERT INTO inventory VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                ("PART-001", "Hydraulic pump assembly", "HP-4402-A", "Hydraulics", 2, 4, 12, "Central stores"),
                ("PART-002", "Engine bearing set", "EB-2190-C", "Propulsion", 7, 5, 21, "Western depot"),
                ("PART-003", "Landing gear actuator", "LGA-8731-B", "Airframe", 1, 3, 18, "North stores"),
                ("PART-004", "Avionics cooling fan", "ACF-1108-D", "Avionics", 9, 4, 9, "Central stores"),
                ("PART-005", "Fuel control unit", "FCU-5500-A", "Fuel system", 3, 4, 28, "Eastern depot"),
                ("PART-006", "Brake wear kit", "BWK-3011-C", "Airframe", 14, 6, 7, "Southern stores"),
            ],
        )


def seed_telemetry(db, alerts, today):
    profiles = {
        "Critical": (0.96, 0.90, 0.94, 0.83),
        "High": (0.79, 0.74, 0.80, 0.66),
        "Medium": (0.62, 0.68, 0.57, 0.70),
        "Low": (0.48, 0.41, 0.55, 0.36),
    }
    samples = []
    for alert in alerts:
        if isinstance(alert, dict):
            aircraft_id = alert["aircraft_id"]
            component = alert["component"]
            severity = alert["severity"]
        elif len(alert) == 3:
            aircraft_id, component, severity = alert
        elif len(alert) == 5:
            aircraft_id, component, severity, _, _ = alert
        else:
            aircraft_id, component, _, severity, _, _, _, _ = alert
        target = profiles[severity]
        seed = sum(map(ord, f"{aircraft_id}:{component}"))
        rng = random.Random(seed)
        start = tuple(max(0.02, value * 0.27) for value in target)
        for cycle in range(24):
            progress = cycle / 23
            values = [
                max(0.0, min(1.0, beginning + (end - beginning) * progress + rng.uniform(-0.018, 0.018)))
                for beginning, end in zip(start, target)
            ]
            samples.append((
                aircraft_id, component, cycle + 1,
                (today - timedelta(days=23 - cycle)).isoformat(),
                *values,
            ))
    db.executemany(
        """INSERT OR IGNORE INTO telemetry_samples
           (aircraft_id, component, sample_cycle, observed_at, vibration_rms,
            thermal_deviation, pressure_drift, response_lag)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        samples,
    )


def rows(db, query, params=()):
    return [dict(row) for row in db.execute(query, params).fetchall()]


def get_predictions(db):
    assessments = rows(
        db,
        """SELECT a.id, a.aircraft_id, a.component, a.created_at,
                  a.acknowledged, f.model, f.squadron, f.base
           FROM alerts a JOIN aircraft f ON f.id = a.aircraft_id""",
    )
    history = rows(
        db,
        """SELECT aircraft_id, component, sample_cycle, observed_at,
                  vibration_rms, thermal_deviation, pressure_drift, response_lag
           FROM telemetry_samples
           ORDER BY aircraft_id, component, sample_cycle""",
    )
    history_by_component = {}
    for sample in history:
        key = (sample["aircraft_id"], sample["component"])
        history_by_component.setdefault(key, []).append(sample)

    predictions = []
    feature_names = ai_engine.FEATURE_NAMES
    for assessment in assessments:
        samples = history_by_component.get(
            (assessment["aircraft_id"], assessment["component"]), []
        )
        if not samples:
            raise ValueError(
                f"Missing telemetry history for {assessment['aircraft_id']} "
                f"{assessment['component']}."
            )
        latest = samples[-1]
        result = ai_engine.predict([latest[name] for name in feature_names])
        rul_cycles = ai_engine.estimate_remaining_cycles(samples)
        result.update({
            **assessment,
            "rul_cycles": rul_cycles,
            "sample_count": len(samples),
            "latest_observed_at": latest["observed_at"],
            "input_signals": [
                {"key": name, "label": ai_engine.FEATURE_LABELS[name],
                 "value": round(latest[name], 3)}
                for name in feature_names
            ],
            "title": (
                f"Elevated {result['top_signals'][0]['label'].lower()} signal"
                if result["risk_probability"] >= ai_engine.ALERT_THRESHOLD
                else "No strong anomaly signal"
            ),
        })
        predictions.append(result)
    return predictions


class AppHandler(BaseHTTPRequestHandler):
    server_version = "AirPowerDemo/1.0"

    def send_json(self, value, status=200):
        payload = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 16_384:
            raise ValueError("Request body is too large.")
        body = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(body, dict):
            raise ValueError("A JSON object is required.")
        return body

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/")
        match = re.fullmatch(r"/api/alerts/(\d+)/acknowledge", path)
        order_status = re.fullmatch(r"/api/work-orders/(\d+)/status", path)
        reserve_part = re.fullmatch(r"/api/inventory/([A-Za-z0-9-]+)/reserve", path)
        try:
            body = self.read_json()
            with connect() as db:
                if match:
                    result = db.execute("UPDATE alerts SET acknowledged = 1 WHERE id = ?", (int(match.group(1)),))
                    if not result.rowcount:
                        return self.send_json({"error": "Alert not found."}, 404)
                    return self.send_json({"ok": True})
                if path == "/api/work-orders":
                    aircraft_id = str(body.get("aircraft_id", ""))
                    title_value = body.get("title", "")
                    title = title_value.strip()[:120] if isinstance(title_value, str) else ""
                    priority = body.get("priority", "Routine")
                    due_date = body.get("due_date", "")
                    if not db.execute("SELECT 1 FROM aircraft WHERE id = ?", (aircraft_id,)).fetchone():
                        return self.send_json({"error": "Select a valid aircraft."}, 400)
                    if not title or not isinstance(priority, str) or priority not in {"Urgent", "High", "Routine"}:
                        return self.send_json({"error": "A title and valid priority are required."}, 400)
                    try:
                        parsed_date = date.fromisoformat(due_date)
                    except (TypeError, ValueError):
                        return self.send_json({"error": "Enter a valid due date."}, 400)
                    cursor = db.execute(
                        """INSERT INTO work_orders (aircraft_id, title, priority, status, due_date, created_at)
                           VALUES (?, ?, ?, 'Scheduled', ?, ?)""",
                        (aircraft_id, title, priority, parsed_date.isoformat(), date.today().isoformat()),
                    )
                    return self.send_json({"ok": True, "id": cursor.lastrowid}, 201)
                if order_status:
                    status = body.get("status")
                    if not isinstance(status, str) or status not in {"Scheduled", "In progress", "Completed"}:
                        return self.send_json({"error": "Choose a valid work order status."}, 400)
                    result = db.execute("UPDATE work_orders SET status = ? WHERE id = ?", (status, int(order_status.group(1))))
                    if not result.rowcount:
                        return self.send_json({"error": "Work order not found."}, 404)
                    return self.send_json({"ok": True})
                if reserve_part:
                    quantity = body.get("quantity")
                    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 1 or quantity > 100:
                        return self.send_json({"error": "Quantity must be a whole number from 1 to 100."}, 400)
                    result = db.execute(
                        "UPDATE inventory SET on_hand = on_hand - ? WHERE id = ? AND on_hand >= ?",
                        (quantity, reserve_part.group(1), quantity),
                    )
                    if not result.rowcount:
                        return self.send_json({"error": "Part not found or available stock is insufficient."}, 409)
                    return self.send_json({"ok": True})
            return self.send_json({"error": "Not found."}, 404)
        except (json.JSONDecodeError, ValueError):
            return self.send_json({"error": "Provide a valid JSON request."}, 400)
        except sqlite3.Error:
            return self.send_json({"error": "The local database could not complete the request."}, 500)

    def do_HEAD(self):
        self.send_response(405)
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_PUT(self):
        self.send_json({"error": "Method not allowed."}, 405)

    def do_DELETE(self):
        self.send_json({"error": "Method not allowed."}, 405)

    def log_message(self, message, *args):
        if self.path.startswith("/api/"):
            super().log_message(message, *args)

    def send_error(self, code, message=None, explain=None):
        if self.path.startswith("/api/"):
            self.send_json({"error": message or "Request failed."}, code)
        else:
            super().send_error(code, message, explain)

    def translate_path(self, path):
        request_path = urlparse(path).path
        if request_path == "/":
            request_path = "/index.html"
        if request_path not in {"/index.html", "/app.js", "/styles.css"}:
            request_path = "/index.html"
        return str(ROOT / request_path.lstrip("/"))

    def do_GET_static(self):
        path = Path(self.translate_path(self.path))
        if not path.is_file():
            path = ROOT / "index.html"
        payload = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if urlparse(self.path).path.startswith("/api/"):
            return self.api_get()
        return self.do_GET_static()

    def api_get(self):
        self._api_get()

    def _api_get(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)
        try:
            with connect() as db:
                if path == "/api/health":
                    return self.send_json({"status": "ok", "mode": "demo", "ai_model": ai_engine.MODEL_VERSION})
                if path == "/api/model":
                    return self.send_json(ai_engine.model_info())
                if path == "/api/dashboard":
                    fleet = rows(db, "SELECT * FROM aircraft ORDER BY id")
                    predictions = get_predictions(db)
                    alerts = [
                        item for item in predictions
                        if not item["acknowledged"] and item["risk_probability"] >= ai_engine.ALERT_THRESHOLD
                    ]
                    alerts.sort(key=lambda item: (item["risk_probability"], item["created_at"]), reverse=True)
                    order_counts = db.execute(
                        "SELECT COUNT(*) AS open, SUM(CASE WHEN priority = 'Urgent' AND status != 'Completed' THEN 1 ELSE 0 END) AS urgent FROM work_orders WHERE status != 'Completed'"
                    ).fetchone()
                    total = len(fleet)
                    available = sum(1 for item in fleet if item["status"] == "Available")
                    return self.send_json({
                        "fleet_total": total,
                        "available": available,
                        "availability": round(available / total * 100) if total else 0,
                        "active_alerts": len(alerts),
                        "open_work_orders": order_counts["open"],
                        "urgent_work_orders": order_counts["urgent"] or 0,
                        "fleet": fleet[:6],
                        "alerts": alerts,
                        "availability_history": [
                            {"day": label, "value": value}
                            for label, value in zip(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], [78, 82, 79, 84, 81, 86, round(available / total * 100) if total else 0])
                        ],
                    })
                if path == "/api/aircraft":
                    search = (query.get("q", [""])[0])[:80]
                    status_filter = query.get("status", [""])[0]
                    sql = "SELECT * FROM aircraft WHERE (id LIKE ? OR model LIKE ? OR squadron LIKE ? OR base LIKE ?)"
                    term = f"%{search}%"
                    params = [term, term, term, term]
                    if status_filter in {"Available", "Inspection", "Grounded"}:
                        sql += " AND status = ?"
                        params.append(status_filter)
                    return self.send_json(rows(db, sql + " ORDER BY id", params))
                if path == "/api/alerts":
                    predictions = get_predictions(db)
                    predictions.sort(key=lambda item: (
                        item["acknowledged"], -item["risk_probability"], item["created_at"]
                    ))
                    return self.send_json(predictions)
                if path == "/api/predictions":
                    predictions = get_predictions(db)
                    predictions.sort(
                        key=lambda item: (
                            item["risk_probability"],
                            -(item["rul_cycles"] or 10000),
                        ),
                        reverse=True,
                    )
                    return self.send_json(predictions)
                if path == "/api/work-orders":
                    return self.send_json(rows(db, """SELECT w.*, f.model, f.squadron FROM work_orders w
                        JOIN aircraft f ON f.id = w.aircraft_id ORDER BY
                        CASE w.status WHEN 'In progress' THEN 0 WHEN 'Scheduled' THEN 1 ELSE 2 END, w.due_date"""))
                if path == "/api/inventory":
                    return self.send_json(rows(db, "SELECT * FROM inventory ORDER BY CASE WHEN on_hand <= reorder_point THEN 0 ELSE 1 END, part"))
            return self.send_json({"error": "Not found."}, 404)
        except sqlite3.Error:
            return self.send_json({"error": "The local database could not complete the request."}, 500)
        except ValueError as error:
            return self.send_json({"error": str(error)}, 500)


if __name__ == "__main__":
    initialize()
    host = "127.0.0.1"
    port = 8000
    print(f"AirPower Maintenance Demo running at http://{host}:{port}")
    ThreadingHTTPServer((host, port), AppHandler).serve_forever()
