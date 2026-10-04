# AirPower Fleet Readiness Demo

A local-first full-stack demonstration of an integrated aircraft maintenance and fleet-availability workspace. It links aircraft, health-monitoring telemetry, technical records, agency assignments, work orders, and spare parts, and scores component sensor histories with a local AI model.

## Run locally

Requires Python 3.10 or newer; no package installation is needed.

```powershell
python server.py
```

Open <http://127.0.0.1:8000>. The SQLite database is created in `data/airpower.db` on first start and persists changes between runs. The server binds to localhost only.

## Deploy to Vercel

The repository includes Vercel routing for the static dashboard and Python API. From the repository root, run `vercel` and follow the CLI prompts to link or create a project, then run `vercel --prod` to publish. The CLI must be authenticated to the intended Vercel account.

Vercel runs the API as a serverless function and stores its demo SQLite database in `/tmp`. That storage is temporary and instance-local: work-order and inventory changes can disappear after an instance restarts and are not shared across instances. This public demo has no authentication and must contain only synthetic sample data. Do not use it for operational information or real maintenance decisions.

## Included

- Fleet availability and health overview with seven-day illustrative trend.
- Searchable aircraft register with fleet readiness and component risk.
- A component digital-twin view joining sensor history, model explanation, maintenance records, agency suggestions, and mapped spare parts.
- Create and update work orders, optionally assign an agency, link a reviewed prediction, and reserve stock in the same transaction.
- Technical-record timeline, inventory thresholds, and part reservations.
- CSV import pages for aircraft, telemetry, maintenance history, and inventory; header and row validation, duplicate handling, record provenance, import audit, and downloadable templates.
- A deterministic logistic-regression classifier (including sensor interaction features) trained at startup on generated sensor examples, with per-component risk scores, explainable leading signals, and trend-based threshold-cycle estimates.
- JSON API under `/api/` for dashboard, aircraft, alerts, predictions, model details, work orders, inventory, agencies, integration status, import audit, and maintenance history. CSV upload endpoints are `/api/import/aircraft`, `/api/import/telemetry`, `/api/import/maintenance`, and `/api/import/inventory`.

Telemetry imports use the exact `telemetry` template header. Sensor feature values must be normalized to `0..1` before upload using an authorized, documented adapter transformation. Imports accept UTF-8 CSV files up to 2 MB and 5,000 data rows. Aircraft records must be loaded before the associated telemetry or technical records.

## Run tests

```powershell
python -m unittest discover -s tests -v
```

## Demo-data and safety notice

Aircraft identifiers, squadrons, locations, sensor histories, generated training labels, model scores, remaining-cycle estimates, work orders, agency assignments, and stock figures are synthetic examples. The local classifier demonstrates an end-to-end machine-learning inference flow; it is trained only on generated data, is not calibrated or validated, and is not evidence of real aircraft failure risk. CSV upload is a manual demo adapter, not a live connection. Do not upload classified, export-controlled, personal, or real operational aircraft data to the public deployment. Do not use this model to dispatch, ground, inspect, repair, certify, or make readiness decisions about real aircraft. This prototype does not connect to aircraft, avionics, external AI services, IMMOLS, e-MMS, ERP, or OEM logistics systems and is not suitable for operational deployment.

## Next steps for a real system

A production program would need authorized persistent shared storage, real-time and batch connectors with source provenance, identity and role-based access controls, tamper-resistant audit trails, threat modeling and security accreditation, representative and independently validated training data, calibrated uncertainty, validated prognostic methods, multi-echelon stock optimization, integration contracts for maintenance and supply systems, and qualified human approval workflows. Open maintenance data standards can inform those interfaces; this demo intentionally does not claim standards compliance. Vercel's demo SQLite database is stored in temporary, instance-local storage, so uploaded records and workflow changes can be lost or differ between instances.
