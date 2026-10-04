import json
import tempfile
import threading
import unittest
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import ai_engine
import server


class AirPowerApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        server.DB_PATH = Path(cls.temp_dir.name) / "airpower-test.db"
        server.initialize()
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.AppHandler)
        cls.httpd.RequestHandlerClass.log_message = lambda *args: None
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=3)
        cls.temp_dir.cleanup()

    def setUp(self):
        for suffix in ("", "-journal", "-wal", "-shm"):
            Path(f"{server.DB_PATH}{suffix}").unlink(missing_ok=True)
        server.initialize()

    def request(self, path, method="GET", body=None, content_type="application/json", extra_headers=None):
        if body is None:
            data = None
        elif isinstance(body, bytes):
            data = body
        else:
            data = json.dumps(body).encode("utf-8")
        headers = {"Content-Type": content_type}
        headers.update(extra_headers or {})
        request = Request(
            self.base_url + path,
            data=data,
            method=method,
            headers=headers,
        )
        try:
            with urlopen(request, timeout=3) as response:
                payload = response.read()
                content_type = response.headers.get("Content-Type", "")
                result = json.loads(payload) if "json" in content_type else payload.decode()
                return response.status, result, response.headers
        except HTTPError as error:
            payload = error.read()
            result = json.loads(payload)
            status, headers = error.code, error.headers
            error.close()
            return status, result, headers

    def test_health_and_static_files(self):
        code, health, _ = self.request("/api/health")
        self.assertEqual(code, 200)
        self.assertEqual(health["status"], "ok")
        self.assertEqual(health["ai_model"], ai_engine.MODEL_VERSION)
        self.assertEqual(self.request("/")[0], 200)
        self.assertEqual(self.request("/app.js")[0], 200)
        self.assertEqual(self.request("/styles.css")[0], 200)
        self.assertEqual(self.request("/../../server.py")[1], self.request("/")[1])

    def test_model_training_and_prediction_are_deterministic(self):
        first = ai_engine.train_classifier()
        second = ai_engine.train_classifier()
        self.assertEqual(first, second)
        low = ai_engine.predict([0.1, 0.1, 0.1, 0.1])
        high = ai_engine.predict([0.9, 0.9, 0.9, 0.9])
        self.assertLess(low["risk_probability"], high["risk_probability"])
        self.assertEqual(high["severity"], "Critical")
        self.assertEqual(len(high["top_signals"]), 3)
        profiles = {
            "Critical": (0.96, 0.90, 0.94, 0.83),
            "High": (0.79, 0.74, 0.80, 0.66),
            "Medium": (0.62, 0.68, 0.57, 0.70),
            "Low": (0.48, 0.41, 0.55, 0.36),
        }
        scores = {name: ai_engine.predict(values)["risk_probability"] for name, values in profiles.items()}
        self.assertGreater(scores["Critical"], scores["High"])
        self.assertGreater(scores["High"], scores["Medium"])
        self.assertGreater(scores["Medium"], scores["Low"])
        self.assertEqual(
            {name: ai_engine.predict(values)["severity"] for name, values in profiles.items()},
            {"Critical": "Critical", "High": "High", "Medium": "Medium", "Low": "Low"},
        )
        with self.assertRaises(ValueError):
            ai_engine.predict([float("nan"), 0, 0, 0])

    def test_model_endpoint_explains_synthetic_training(self):
        code, model, _ = self.request("/api/model")
        self.assertEqual(code, 200)
        self.assertTrue(model["trained_on_synthetic_data"])
        self.assertFalse(model["operationally_validated"])
        self.assertEqual(model["training_samples"], 2400)
        self.assertEqual(len(model["features"]), 4)

    def test_dashboard_and_predictions_use_trained_model(self):
        code, dashboard, _ = self.request("/api/dashboard")
        self.assertEqual(code, 200)
        self.assertEqual(dashboard["fleet_total"], 12)
        self.assertEqual(dashboard["available"], 9)
        self.assertEqual(len(dashboard["availability_history"]), 7)
        code, predictions, _ = self.request("/api/predictions")
        self.assertEqual(code, 200)
        self.assertEqual(len(predictions), 7)
        self.assertTrue(all(item["sample_count"] == 24 for item in predictions))
        self.assertTrue(all(item["model_version"] == ai_engine.MODEL_VERSION for item in predictions))
        self.assertTrue(all(0 <= item["risk_percent"] <= 100 for item in predictions))
        self.assertTrue(all(item["rul_cycles"] is None or item["rul_cycles"] >= 1 for item in predictions))
        self.assertEqual(
            [item["risk_probability"] for item in predictions],
            sorted((item["risk_probability"] for item in predictions), reverse=True),
        )
        self.assertEqual(predictions[0]["severity"], "Critical")
        self.assertEqual(predictions[-1]["severity"], "Low")
        expected_active = sum(
            not item["acknowledged"] and item["risk_probability"] >= ai_engine.ALERT_THRESHOLD
            for item in predictions
        )
        self.assertEqual(dashboard["active_alerts"], expected_active)
        model_status, model, _ = self.request("/api/model")
        self.assertEqual(model_status, 200)
        alerts = self.request("/api/alerts")[1]
        self.assertIn(model["version"], alerts[0]["model_version"])
        self.assertNotIn("confidence", alerts[0])

    def test_search_and_status_filter(self):
        self.assertEqual(len(self.request("/api/aircraft?q=AC-3")[1]), 2)
        grounded = self.request("/api/aircraft?status=Grounded")[1]
        self.assertEqual([item["id"] for item in grounded], ["AC-308"])
        self.assertEqual(self.request("/api/aircraft?q=does-not-exist")[1], [])
        risk = next(item for item in self.request("/api/aircraft?q=AC-308")[1] if item["id"] == "AC-308")
        self.assertEqual(risk["ai_risk_percent"], 95)
        self.assertEqual(risk["components_monitored"], 1)

    def test_work_order_create_update_and_validation(self):
        due_date = (date.today() + timedelta(days=4)).isoformat()
        code, created, _ = self.request(
            "/api/work-orders",
            "POST",
            {
                "aircraft_id": "AC-104",
                "title": "Synthetic test inspection",
                "priority": "High",
                "due_date": due_date,
            },
        )
        self.assertEqual(code, 201)
        self.assertIsInstance(created["id"], int)
        code, _, _ = self.request(
            f"/api/work-orders/{created['id']}/status",
            "POST",
            {"status": "Completed"},
        )
        self.assertEqual(code, 200)
        self.assertEqual(
            self.request(
                "/api/work-orders",
                "POST",
                {
                    "aircraft_id": "unknown",
                    "title": "",
                    "priority": "Critical",
                    "due_date": "not-a-date",
                },
            )[0],
            400,
        )
        self.assertEqual(
            self.request("/api/work-orders/1/status", "POST", {"status": "Invalid"})[0],
            400,
        )

    def test_acknowledgement_and_inventory_reservations(self):
        self.assertEqual(self.request("/api/alerts")[0], 200)
        self.assertEqual(self.request("/api/alerts/1/acknowledge", "POST", {})[0], 200)
        self.assertEqual(self.request("/api/inventory/PART-001/reserve", "POST", {"quantity": 1})[0], 200)
        self.assertEqual(self.request("/api/inventory/PART-001/reserve", "POST", {"quantity": 99})[0], 409)
        self.assertEqual(self.request("/api/inventory/PART-001/reserve", "POST", {"quantity": True})[0], 400)
        self.assertEqual(self.request("/api/inventory/unknown/reserve", "POST", {"quantity": 1})[0], 409)

    def test_existing_database_gets_idempotent_telemetry_migration(self):
        with server.connect() as db:
            before = db.execute("SELECT COUNT(*) FROM telemetry_samples").fetchone()[0]
        server.initialize()
        with server.connect() as db:
            after = db.execute("SELECT COUNT(*) FROM telemetry_samples").fetchone()[0]
        self.assertEqual(after, before)
        self.assertGreaterEqual(after, 7 * 24)

    def test_csv_import_ingests_telemetry_and_runs_model(self):
        aircraft_csv = (
            "id,model,squadron,base,status,flight_hours,last_service,health,next_inspection\n"
            "AC-900,Demo type,Demo squadron,Demo base,Available,22,2026-09-01,90,2026-12-01\n"
        ).encode()
        code, imported, _ = self.request(
            "/api/import/aircraft", "POST", aircraft_csv, "text/csv",
            {"X-Filename": "fleet.csv"},
        )
        self.assertEqual(code, 200)
        self.assertEqual(imported["accepted_rows"], 1)

        sensor_header = "aircraft_id,component,observed_at,vibration_rms,thermal_deviation,pressure_drift,response_lag\n"
        sensor_rows = "".join(
            f"AC-900,Demo actuator,2026-10-{day:02d},{value},{value},{value},{value}\n"
            for day, value in ((2, 0.2), (3, 0.4), (4, 0.7))
        )
        code, imported, _ = self.request(
            "/api/import/telemetry", "POST", (sensor_header + sensor_rows).encode(),
            "text/csv", {"X-Filename": "health.csv"},
        )
        self.assertEqual(code, 200)
        self.assertEqual(imported["accepted_rows"], 3)
        prediction = next(
            item for item in self.request("/api/predictions")[1]
            if item["aircraft_id"] == "AC-900"
        )
        self.assertEqual(prediction["data_source"], "CSV: health.csv")
        self.assertEqual(prediction["sample_count"], 3)
        self.assertGreater(prediction["risk_percent"], 50)

        code, imported, _ = self.request(
            "/api/import/telemetry", "POST", (sensor_header + sensor_rows.splitlines()[1] + "\n").encode(),
            "text/csv", {"X-Filename": "duplicate.csv"},
        )
        self.assertEqual(code, 200)
        self.assertEqual(imported["duplicate_rows"], 1)
        self.assertEqual(imported["accepted_rows"], 0)

    def test_csv_import_reports_row_errors_without_discarding_valid_rows(self):
        payload = (
            "id,model,squadron,base,status,flight_hours,last_service,health,next_inspection\n"
            "AC-901,Demo type,Demo squadron,Demo base,Available,22,2026-09-01,90,2026-12-01\n"
            "AC-902,Demo type,Demo squadron,Demo base,Unavailable,22,not-a-date,150,2026-12-01\n"
        ).encode()
        code, report, _ = self.request(
            "/api/import/aircraft", "POST", payload, "text/csv",
            {"X-Filename": "mixed.csv"},
        )
        self.assertEqual(code, 200)
        self.assertEqual(report["accepted_rows"], 1)
        self.assertEqual(report["rejected_rows"], 1)
        self.assertEqual(report["errors"][0]["line"], 3)
        self.assertEqual(len(self.request("/api/aircraft?q=AC-901")[1]), 1)
        self.assertEqual(self.request("/api/aircraft?q=AC-902")[1], [])

    def test_csv_import_normalizes_headers_and_requires_iso_dates(self):
        payload = (
            " aircraft_id , component , observed_at , vibration_rms , thermal_deviation , pressure_drift , response_lag \n"
            "AC-308,Demo control,2026-10-03,0.2,0.3,0.2,0.1\n"
            "AC-308,Demo control,20261004,0.2,0.3,0.2,0.1\n"
        ).encode()
        code, report, _ = self.request(
            "/api/import/telemetry", "POST", payload, "text/csv",
        )
        self.assertEqual(code, 200)
        self.assertEqual(report["accepted_rows"], 1)
        self.assertEqual(report["rejected_rows"], 1)
        self.assertIn("YYYY-MM-DD", report["errors"][0]["error"])

    def test_csv_import_checks_headers_aircraft_references_and_feature_ranges(self):
        code, result, _ = self.request(
            "/api/import/telemetry", "POST", b"wrong,headers\n1,2\n",
            "text/csv",
        )
        self.assertEqual(code, 400)
        self.assertIn("missing required columns", result["error"])
        invalid_sensor = (
            "aircraft_id,component,observed_at,vibration_rms,thermal_deviation,pressure_drift,response_lag\n"
            "UNKNOWN,Actuator,2026-10-04,1.2,0.5,0.4,0.2\n"
            "AC-104,Oil filter,2026-10-04,1.2,0.5,0.4,0.2\n"
        ).encode()
        code, report, _ = self.request(
            "/api/import/telemetry", "POST", invalid_sensor, "text/csv",
        )
        self.assertEqual(code, 422)
        self.assertEqual(report["rejected_rows"], 2)

    def test_maintenance_inventory_import_and_work_order_linkage(self):
        maintenance_csv = (
            "aircraft_id,component,record_type,performed_at,agency,reference,notes\n"
            "AC-308,Hydraulic pump,Inspection,2026-10-01,Demo maintenance,REF-901,CSV record\n"
        ).encode()
        self.assertEqual(self.request("/api/import/maintenance", "POST", maintenance_csv, "text/csv")[0], 200)
        inventory_csv = (
            "id,part,part_number,category,on_hand,reorder_point,lead_days,location\n"
            "PART-001,Hydraulic pump assembly,HP-4402-A,Hydraulics,5,4,12,Central stores\n"
        ).encode()
        self.assertEqual(self.request("/api/import/inventory", "POST", inventory_csv, "text/csv")[0], 200)
        prediction = next(
            item for item in self.request("/api/predictions")[1]
            if item["aircraft_id"] == "AC-308"
        )
        self.assertEqual(prediction["latest_maintenance_record"]["reference"], "REF-901")
        self.assertEqual(prediction["recommended_spare"]["id"], "PART-001")
        agency = prediction["recommended_agency"]
        code, work_order, _ = self.request(
            "/api/work-orders", "POST",
            {
                "aircraft_id": "AC-308",
                "title": "Review demo pump inspection",
                "component": "Hydraulic pump",
                "priority": "High",
                "due_date": (date.today() + timedelta(days=3)).isoformat(),
                "agency_id": agency["id"],
                "source_alert_id": prediction["id"],
                "inventory_id": "PART-001",
                "quantity": 2,
            },
        )
        self.assertEqual(code, 201)
        created = next(
            item for item in self.request("/api/work-orders")[1]
            if item["id"] == work_order["id"]
        )
        self.assertEqual(created["agency_name"], agency["name"])
        self.assertEqual(created["reserved_quantity"], 2)
        self.assertEqual(created["reservation_status"], "Reserved")
        self.assertEqual(created["source_alert_id"], prediction["id"])
        linked_prediction = next(
            item for item in self.request("/api/alerts")[1] if item["id"] == prediction["id"]
        )
        self.assertTrue(linked_prediction["acknowledged"])
        stock = next(item for item in self.request("/api/inventory")[1] if item["id"] == "PART-001")
        self.assertEqual(stock["on_hand"], 3)
        self.assertEqual(
            self.request(f"/api/work-orders/{work_order['id']}/status", "POST", {"status": "Completed"})[0],
            200,
        )
        completed = next(
            item for item in self.request("/api/work-orders")[1] if item["id"] == work_order["id"]
        )
        self.assertEqual(completed["reservation_status"], "Consumed")

    def test_integration_status_exposes_active_sources_and_import_audit(self):
        inventory_csv = (
            "id,part,part_number,category,on_hand,reorder_point,lead_days,location\n"
            "PART-901,Demo filter,DF-901,Demo,2,1,14,Demo store\n"
        ).encode()
        self.assertEqual(self.request("/api/import/inventory", "POST", inventory_csv, "text/csv")[0], 200)
        code, integration, _ = self.request("/api/integrations")
        self.assertEqual(code, 200)
        self.assertFalse(integration["live_connections"])
        self.assertEqual(len(integration["data_sources"]), 4)
        self.assertGreater(integration["data_sources"][0]["records"], 0)
        self.assertGreater(len(integration["recent_imports"]), 0)
        self.assertEqual(self.request("/api/agencies")[0], 200)
        self.assertEqual(self.request("/api/maintenance-history?aircraft_id=AC-308")[0], 200)


if __name__ == "__main__":
    unittest.main()
