# AirPower Fleet Readiness Demo

A local-first full-stack demonstration of an integrated aircraft maintenance and fleet-availability workspace. It includes a responsive operations dashboard, aircraft register, AI-scored synthetic sensor histories, work-order tracking, and a small inventory view.

## Run locally

Requires Python 3.10 or newer; no package installation is needed.

```powershell
python server.py
```

Open <http://127.0.0.1:8000>. The SQLite database is created in `data/airpower.db` on first start and persists changes between runs. The server binds to localhost only.

## Included

- Fleet availability and health overview with seven-day illustrative trend.
- Searchable aircraft register and status filters.
- Component prediction review and acknowledgement.
- Create and update maintenance work orders.
- Sample inventory threshold indicators and stock reservations.
- A deterministic logistic-regression classifier (including sensor interaction features) trained at startup on generated sensor examples, with per-component risk scores, explainable leading signals, and trend-based threshold-cycle estimates.
- JSON API under `/api/` for dashboard, aircraft, alerts, predictions, model details, work orders, and inventory.

## Run tests

```powershell
python -m unittest discover -s tests -v
```

## Demo-data and safety notice

Aircraft identifiers, squadrons, locations, sensor histories, generated training labels, model scores, remaining-cycle estimates, work orders, and stock figures are synthetic examples. The local classifier demonstrates an end-to-end machine-learning inference flow; it is trained only on generated data, is not calibrated or validated, and is not evidence of real aircraft failure risk. Do not use it to dispatch, ground, inspect, repair, certify, or make readiness decisions about real aircraft. This prototype does not connect to aircraft, avionics, external AI services, or logistics systems and is not suitable for operational deployment.

## Next steps for a real system

A production program would need authorized data connectors and provenance, identity and role-based access controls, audit trails, threat modeling and security accreditation, representative and independently validated training data, calibrated uncertainty, validated prognostic methods, integration contracts for maintenance and supply systems, and qualified human approval workflows. Open maintenance data standards can inform those interfaces; this demo intentionally does not claim standards compliance.
