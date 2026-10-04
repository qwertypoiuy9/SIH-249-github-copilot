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

    def request(self, path, method="GET", body=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
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
        server.initialize()
        with server.connect() as db:
            count = db.execute("SELECT COUNT(*) FROM telemetry_samples").fetchone()[0]
        self.assertEqual(count, 7 * 24)


if __name__ == "__main__":
    unittest.main()
