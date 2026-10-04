"""Small, explainable demo classifier trained only on generated sensor examples."""

import math
import random


MODEL_VERSION = "airpower-logistic-demo-1.0"
FEATURE_NAMES = (
    "vibration_rms",
    "thermal_deviation",
    "pressure_drift",
    "response_lag",
)
FEATURE_LABELS = {
    "vibration_rms": "Vibration",
    "thermal_deviation": "Thermal deviation",
    "pressure_drift": "Pressure drift",
    "response_lag": "Response lag",
}
FEATURE_WEIGHTS = (0.37, 0.22, 0.25, 0.16)
ALERT_THRESHOLD = 0.50


def _sigmoid(value):
    value = max(-30.0, min(30.0, value))
    return 1.0 / (1.0 + math.exp(-value))


def _risk_signal(features):
    weighted = sum(weight * value for weight, value in zip(FEATURE_WEIGHTS, features))
    interaction = 0.10 * features[0] * features[2] + 0.08 * features[1] * features[3]
    return weighted + interaction


def _transform(features):
    return [
        *features,
        features[0] * features[2],
        features[1] * features[3],
    ]


def _training_data():
    rng = random.Random(26249)
    samples = []
    for _ in range(2400):
        features = [rng.random() for _ in FEATURE_NAMES]
        synthetic_risk = _sigmoid((_risk_signal(features) - 0.62) * 7.0)
        label = 1.0 if rng.random() < synthetic_risk else 0.0
        samples.append((_transform(features), label))
    return samples


def train_classifier():
    """Fit a deterministic binary logistic-regression model on synthetic data."""
    samples = _training_data()
    weights = [0.0] * (len(FEATURE_NAMES) + 2)
    bias = 0.0
    learning_rate = 0.8
    for _ in range(240):
        gradient = [0.0] * len(weights)
        bias_gradient = 0.0
        for features, label in samples:
            prediction = _sigmoid(bias + sum(w * x for w, x in zip(weights, features)))
            error = prediction - label
            bias_gradient += error
            for index, feature in enumerate(features):
                gradient[index] += error * feature
        scale = learning_rate / len(samples)
        bias -= scale * bias_gradient
        weights = [weight - scale * slope for weight, slope in zip(weights, gradient)]
    return {"weights": weights, "bias": bias, "samples": len(samples)}


MODEL = train_classifier()


def predict(features):
    """Return anomaly probability, signal contributions, and trend-based RUL."""
    if len(features) != len(FEATURE_NAMES):
        raise ValueError("The model requires exactly four sensor features.")
    normalized = []
    for feature in features:
        value = float(feature)
        if not math.isfinite(value):
            raise ValueError("Sensor features must be finite numbers.")
        normalized.append(max(0.0, min(1.0, value)))

    transformed = _transform(normalized)
    logit = MODEL["bias"] + sum(
        weight * feature for weight, feature in zip(MODEL["weights"], transformed)
    )
    probability = _sigmoid(logit)
    contributions = [
        {
            "feature": name,
            "label": FEATURE_LABELS[name],
            "value": round(value, 3),
            "contribution": round(weight * value, 4),
        }
        for name, value, weight in zip(FEATURE_NAMES, normalized, MODEL["weights"][:4])
    ]
    interactions = (
        ("vibration_pressure_interaction", "Vibration × pressure", transformed[4], MODEL["weights"][4]),
        ("thermal_response_interaction", "Thermal × response", transformed[5], MODEL["weights"][5]),
    )
    contributions.extend(
        {
            "feature": name,
            "label": label,
            "value": round(value, 3),
            "contribution": round(weight * value, 4),
        }
        for name, label, value, weight in interactions
    )
    contributions.sort(key=lambda item: item["contribution"], reverse=True)
    return {
        "risk_probability": round(probability, 4),
        "risk_percent": round(probability * 100),
        "severity": severity_for(probability),
        "top_signals": contributions[:3],
        "model_version": MODEL_VERSION,
    }


def severity_for(probability):
    if probability >= 0.85:
        return "Critical"
    if probability >= 0.70:
        return "High"
    if probability >= ALERT_THRESHOLD:
        return "Medium"
    return "Low"


def estimate_remaining_cycles(history, threshold=0.90):
    """Estimate threshold crossing from the steepest recent sensor trend."""
    if len(history) < 2:
        return None
    window = history[-min(len(history), 12):]
    crossings = []
    for feature in FEATURE_NAMES:
        values = [float(sample[feature]) for sample in window]
        mean_x = (len(values) - 1) / 2
        mean_y = sum(values) / len(values)
        denominator = sum((index - mean_x) ** 2 for index in range(len(values)))
        if denominator == 0:
            continue
        slope = sum(
            (index - mean_x) * (value - mean_y)
            for index, value in enumerate(values)
        ) / denominator
        if slope > 0:
            remaining = (threshold - values[-1]) / slope
            if remaining >= 0:
                crossings.append(remaining)
    if not crossings:
        return None
    return max(1, min(9999, round(min(crossings))))


def model_info():
    return {
        "name": "Synthetic-sensor logistic regression",
        "version": MODEL_VERSION,
        "training_samples": MODEL["samples"],
        "features": [
            {"key": name, "label": FEATURE_LABELS[name]}
            for name in FEATURE_NAMES
        ],
        "trained_on_synthetic_data": True,
        "operationally_validated": False,
        "method": "Binary logistic regression with vibration-pressure and thermal-response interaction terms",
        "risk_threshold": ALERT_THRESHOLD,
        "rul_method": "Linear trend to a synthetic normalized sensor threshold",
    }
